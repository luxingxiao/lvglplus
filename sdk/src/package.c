/* SPDX-License-Identifier: Apache-2.0 */
#include "lvglplus.h"
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
typedef struct block {
    void *data;
    struct block *next;
} block;
struct lvp_package {
    lvp_schema schema;
    block *blocks;
};
typedef struct {
    const uint8_t *p, *end;
    lvp_package *package;
    int failed;
} reader;
static void *memory(reader *r, size_t n) {
    block *b;
    if (r->failed)
        return NULL;
    b = calloc(1, sizeof(*b));
    if (!b) {
        r->failed = 1;
        return NULL;
    }
    b->data = calloc(1, n ? n : 1);
    if (!b->data) {
        free(b);
        r->failed = 1;
        return NULL;
    }
    b->next = r->package->blocks;
    r->package->blocks = b;
    return b->data;
}
static uint32_t word(reader *r) {
    uint32_t v;
    if (r->failed || (size_t)(r->end - r->p) < 4) {
        r->failed = 1;
        return 0;
    }
    v = (uint32_t)r->p[0] | (uint32_t)r->p[1] << 8 | (uint32_t)r->p[2] << 16 | (uint32_t)r->p[3] << 24;
    r->p += 4;
    return v;
}
static double real(reader *r) {
    uint64_t bits;
    double d;
    uint32_t lo = word(r), hi = word(r);
    bits = (uint64_t)lo | ((uint64_t)hi << 32);
    memcpy(&d, &bits, 8);
    if (!isfinite(d))
        r->failed = 1;
    return d;
}
static uint32_t count(reader *r, uint32_t max) {
    uint32_t n = word(r);
    if (n > max) {
        r->failed = 1;
        return 0;
    }
    return n;
}
static const char *text(reader *r) {
    uint32_t n = count(r, 4096);
    char *s;
    if (r->failed || (size_t)(r->end - r->p) < n) {
        r->failed = 1;
        return "";
    }
    s = memory(r, n + 1);
    if (!s)
        return "";
    if (memchr(r->p, 0, n)) {
        r->failed = 1;
        return "";
    }
    memcpy(s, r->p, n);
    r->p += n;
    return s;
}
lvp_package *lvp_package_load(const uint8_t *data, size_t size, char *error, size_t error_size) {
    reader r;
    lvp_schema *s;
    uint32_t i, j;
    lvp_signal_def *signals;
    uint32_t *order;
    lvp_command_def *commands;
    lvp_node_def *nodes;
    if (!data || size < 20 || size > 8 * 1024 * 1024)
        goto invalid_without_package;
    memset(&r, 0, sizeof(r));
    r.p = data;
    r.end = data + size;
    r.package = calloc(1, sizeof(lvp_package));
    if (!r.package)
        goto invalid_without_package;
    s = &r.package->schema;
    if (word(&r) != 0x3150564c)
        r.failed = 1;
    s->version = word(&r);
    s->width = count(&r, 4096);
    s->height = count(&r, 4096);
    s->initial_page = text(&r);
    if (s->version != 1 || !s->width || !s->height)
        r.failed = 1;
    s->signal_count = count(&r, LVP_SIGNAL_MAX);
    signals = memory(&r, s->signal_count * sizeof(*signals));
    s->signals = signals;
    if (r.failed)
        goto invalid;
    for (i = 0; i < s->signal_count && !r.failed; i++) {
        lvp_instruction *code;
        signals[i].name = text(&r);
        signals[i].type = word(&r);
        signals[i].initial = real(&r);
        signals[i].text = text(&r);
        signals[i].timeout_ms = word(&r);
        signals[i].choice_count = count(&r, 256);
        {
            const char **choices = memory(&r, signals[i].choice_count * sizeof(*choices));
            signals[i].choices = choices;
            if (r.failed)
                break;
            for (j = 0; j < signals[i].choice_count && !r.failed; j++)
                choices[j] = text(&r);
        }
        signals[i].unit = text(&r);
        signals[i].code_count = count(&r, 96);
        code = memory(&r, signals[i].code_count * sizeof(*code));
        signals[i].code = code;
        if (r.failed)
            break;
        for (j = 0; j < signals[i].code_count && !r.failed; j++) {
            code[j].op = word(&r);
            code[j].signal = word(&r);
            code[j].value = real(&r);
            if (code[j].op > LVP_JUMP || (code[j].op == LVP_LOAD && code[j].signal >= s->signal_count))
                r.failed = 1;
        }
    }
    if (count(&r, LVP_SIGNAL_MAX) != s->signal_count)
        r.failed = 1;
    order = memory(&r, s->signal_count * sizeof(*order));
    s->evaluation_order = order;
    if (r.failed)
        goto invalid;
    for (i = 0; i < s->signal_count; i++)
        order[i] = word(&r);
    s->command_count = count(&r, 256);
    commands = memory(&r, s->command_count * sizeof(*commands));
    s->commands = commands;
    if (r.failed)
        goto invalid;
    for (i = 0; i < s->command_count && !r.failed; i++) {
        uint32_t idx;
        commands[i].name = text(&r);
        idx = word(&r);
        commands[i].signal = idx == UINT32_MAX ? -1 : (int32_t)idx;
        commands[i].value = real(&r);
        if (idx != UINT32_MAX && idx >= s->signal_count)
            r.failed = 1;
    }
    s->node_count = count(&r, LVP_NODE_MAX);
    nodes = memory(&r, s->node_count * sizeof(*nodes));
    s->nodes = nodes;
    if (r.failed || !s->node_count)
        goto invalid;
    for (i = 0; i < s->node_count && !r.failed; i++) {
        lvp_property *props;
        lvp_binding_def *bindings;
        uint32_t parent;
        nodes[i].id = text(&r);
        nodes[i].kind = word(&r);
        parent = word(&r);
        nodes[i].parent = parent == UINT32_MAX ? -1 : (int32_t)parent;
        nodes[i].command = text(&r);
        if (nodes[i].kind > 7 || (parent != UINT32_MAX && parent >= i) ||
            (parent == UINT32_MAX && nodes[i].kind != 0))
            r.failed = 1;
        nodes[i].property_count = count(&r, 64);
        props = memory(&r, nodes[i].property_count * sizeof(*props));
        nodes[i].properties = props;
        if (r.failed)
            break;
        for (j = 0; j < nodes[i].property_count && !r.failed; j++) {
            props[j].name = text(&r);
            props[j].value = text(&r);
        }
        nodes[i].binding_count = count(&r, 6);
        bindings = memory(&r, nodes[i].binding_count * sizeof(*bindings));
        nodes[i].bindings = bindings;
        if (r.failed)
            break;
        for (j = 0; j < nodes[i].binding_count && !r.failed; j++) {
            uint32_t kind = nodes[i].kind, prop;
            bindings[j].property = word(&r);
            bindings[j].signal = word(&r);
            bindings[j].two_way = word(&r);
            bindings[j].format = text(&r);
            prop = bindings[j].property;
            if (prop > LVP_BIND_QUALITY || bindings[j].signal >= s->signal_count || bindings[j].two_way > 1) {
                r.failed = 1;
                break;
            }
            if ((prop == LVP_BIND_TEXT || prop == LVP_BIND_QUALITY) && kind != 1 && kind != 2)
                r.failed = 1;
            if (prop == LVP_BIND_VALUE && kind != 3 && kind != 4 && kind != 5)
                r.failed = 1;
            if (prop == LVP_BIND_CHECKED && kind != 6)
                r.failed = 1;
            if (bindings[j].two_way &&
                (!((kind == 4 && prop == LVP_BIND_VALUE) || (kind == 6 && prop == LVP_BIND_CHECKED)) ||
                 signals[bindings[j].signal].code_count))
                r.failed = 1;
        }
    }
    if (r.failed || r.p != r.end)
        goto invalid;
    {
        lvp_context *ctx = lvp_create(s, NULL);
        if (!ctx)
            goto invalid;
        lvp_destroy(ctx);
    }
    if (error && error_size)
        error[0] = 0;
    return r.package;
invalid:
    lvp_package_free(r.package);
invalid_without_package:
    if (error && error_size)
        snprintf(error, error_size, "Invalid or unsupported LVGL Plus package");
    return NULL;
}
const lvp_schema *lvp_package_schema(const lvp_package *p) {
    return p ? &p->schema : NULL;
}
void lvp_package_free(lvp_package *p) {
    block *b;
    if (!p)
        return;
    b = p->blocks;
    while (b) {
        block *next = b->next;
        free(b->data);
        free(b);
        b = next;
    }
    free(p);
}
