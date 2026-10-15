/* SPDX-License-Identifier: Apache-2.0 */
#include "lvglplus.h"
#include <math.h>
#include <stdlib.h>
#include <string.h>

struct lvp_subscription {
    uint32_t signal;
    lvp_observer_fn callback;
    void *user;
    int removed;
    struct lvp_subscription *next;
};
typedef struct {
    uint32_t signal;
    uint32_t adapter, generation;
    lvp_value value;
    int is_event;
} queue_item;
typedef struct {
    uint32_t id;
    lvp_command_status status;
} command_entry;
typedef struct {
    lvp_adapter_ops ops;
    void *user;
    lvp_adapter_info info;
    uint32_t generation;
} adapter_entry;
struct lvp_context {
    const lvp_schema *schema;
    lvp_hal hal;
    lvp_value *values;
    uint8_t *dirty;
    lvp_subscription *subscriptions;
    uint32_t batch, dispatching;
    queue_item *queue;
    uint32_t queue_size, queue_head, queue_count;
    lvp_queue_stats stats;
    uint64_t now;
    lvp_command_fn command_handler;
    void *command_user;
    uint32_t next_request;
    command_entry requests[32];
    adapter_entry adapters[8];
    uint32_t adapter_count;
};
static void *default_allocate(size_t n, void *u) {
    (void)u;
    return calloc(1, n);
}
static void default_free(void *p, void *u) {
    (void)u;
    free(p);
}
static void *allocate(lvp_context *c, size_t n) {
    void *p = c->hal.allocate(n, c->hal.user);
    if (p)
        memset(p, 0, n);
    return p;
}
static int valid_number(const lvp_signal_def *d, double n) {
    if (!isfinite(n))
        return 0;
    if (d->type == LVP_STRING)
        return 0;
    if (d->type == LVP_BOOLEAN)
        return n == 0 || n == 1;
    if (d->type == LVP_INTEGER || d->type == LVP_ENUM) {
        if (trunc(n) != n || n < INT32_MIN || n > INT32_MAX)
            return 0;
        if (d->type == LVP_ENUM && (n < 0 || n >= d->choice_count))
            return 0;
    }
    return 1;
}
static void sweep(lvp_context *c) {
    lvp_subscription **link = &c->subscriptions;
    while (*link) {
        if ((*link)->removed) {
            lvp_subscription *s = *link;
            *link = s->next;
            c->hal.deallocate(s, c->hal.user);
        } else
            link = &(*link)->next;
    }
}
static void flush(lvp_context *c) {
    uint32_t pass, i;
    if (c->batch || c->dispatching)
        return;
    c->dispatching = 1;
    for (pass = 0; pass < 32; pass++) {
        int any = 0;
        for (i = 0; i < c->schema->signal_count; i++) {
            uint32_t idx = c->schema->evaluation_order[i];
            const lvp_signal_def *d = &c->schema->signals[idx];
            if (d->code_count) {
                double n = 0;
                lvp_quality q = LVP_VALID;
                if (lvp_evaluate(d->code, d->code_count, c->values, c->schema->signal_count, &n, &q) !=
                        LVP_OK ||
                    !valid_number(d, n)) {
                    n = c->values[idx].number;
                    q = LVP_INVALID;
                }
                if (c->values[idx].number != n || c->values[idx].quality != q) {
                    c->values[idx].number = n;
                    c->values[idx].quality = q;
                    c->values[idx].timestamp_ms = c->now;
                    c->dirty[idx] = 1;
                }
            }
        }
        for (i = 0; i < c->schema->signal_count; i++)
            if (c->dirty[i]) {
                lvp_subscription *s;
                any = 1;
                c->dirty[i] = 0;
                for (s = c->subscriptions; s; s = s->next)
                    if (!s->removed && s->signal == i)
                        s->callback(c, i, &c->values[i], s->user);
            }
        if (!any)
            break;
    }
    if (pass == 32 && c->hal.log)
        c->hal.log("Observer update limit reached; check for a feedback loop", c->hal.user);
    c->dispatching = 0;
    sweep(c);
}
lvp_context *lvp_create(const lvp_schema *s, const lvp_hal *config) {
    lvp_hal h;
    lvp_context *c;
    uint32_t i;
    uint8_t seen[LVP_SIGNAL_MAX] = {0};
    if (!s || (s->version != 1 && s->version != 2) || s->signal_count > LVP_SIGNAL_MAX ||
        (s->signal_count && (!s->signals || !s->evaluation_order)))
        return NULL;
    memset(&h, 0, sizeof(h));
    if (config)
        h = *config;
    if ((h.allocate == NULL) != (h.deallocate == NULL) || (h.lock == NULL) != (h.unlock == NULL))
        return NULL;
    if (!h.allocate) {
        h.allocate = default_allocate;
        h.deallocate = default_free;
    }
    for (i = 0; i < s->signal_count; i++) {
        uint32_t idx = s->evaluation_order[i], j;
        const lvp_signal_def *d;
        if (idx >= s->signal_count || seen[idx])
            return NULL;
        d = &s->signals[idx];
        if (d->type > LVP_ENUM || !d->name || !d->text || strlen(d->text) > LVP_STRING_MAX ||
            d->code_count > 96 || (d->code_count && !d->code))
            return NULL;
        if (d->type != LVP_STRING && !valid_number(d, d->initial))
            return NULL;
        for (j = 0; j < d->code_count; j++)
            if (d->code[j].op == LVP_LOAD &&
                (d->code[j].signal >= s->signal_count || !seen[d->code[j].signal]))
                return NULL;
        seen[idx] = 1;
    }
    c = h.allocate(sizeof(*c), h.user);
    if (!c)
        return NULL;
    memset(c, 0, sizeof(*c));
    c->schema = s;
    c->hal = h;
    c->queue_size = h.queue_capacity ? h.queue_capacity : 32;
    if (c->queue_size > 4096) {
        h.deallocate(c, h.user);
        return NULL;
    }
    c->values = allocate(c, (s->signal_count + 1) * sizeof(lvp_value));
    c->dirty = allocate(c, s->signal_count + 1);
    c->queue = allocate(c, c->queue_size * sizeof(queue_item));
    if (!c->values || !c->dirty || !c->queue) {
        lvp_destroy(c);
        return NULL;
    }
    for (i = 0; i < s->signal_count; i++) {
        c->values[i].number = s->signals[i].initial;
        strcpy(c->values[i].text, s->signals[i].text);
        c->dirty[i] = 1;
    }
    flush(c);
    return c;
}
void lvp_destroy(lvp_context *c) {
    lvp_subscription *s;
    lvp_hal h;
    if (!c)
        return;
    for (uint32_t i = 0; i < c->adapter_count; i++)
        lvp_adapter_stop(c, i);
    h = c->hal;
    s = c->subscriptions;
    while (s) {
        lvp_subscription *next = s->next;
        h.deallocate(s, h.user);
        s = next;
    }
    if (c->values)
        h.deallocate(c->values, h.user);
    if (c->dirty)
        h.deallocate(c->dirty, h.user);
    if (c->queue)
        h.deallocate(c->queue, h.user);
    h.deallocate(c, h.user);
}
const lvp_schema *lvp_get_schema(const lvp_context *c) {
    return c ? c->schema : NULL;
}
uint64_t lvp_now(const lvp_context *c) {
    return c ? c->now : 0;
}
int32_t lvp_find(const lvp_context *c, const char *name) {
    uint32_t i;
    if (!c || !name)
        return -1;
    for (i = 0; i < c->schema->signal_count; i++)
        if (!strcmp(c->schema->signals[i].name, name))
            return (int32_t)i;
    return -1;
}
const lvp_value *lvp_get(const lvp_context *c, uint32_t i) {
    return c && i < c->schema->signal_count ? &c->values[i] : NULL;
}
lvp_result lvp_set_number(lvp_context *c, uint32_t i, double n, uint64_t t, lvp_quality q) {
    lvp_value *v;
    if (!c || i >= c->schema->signal_count || q > LVP_DISCONNECTED)
        return LVP_RANGE;
    if (c->schema->signals[i].code_count)
        return LVP_READONLY;
    if (!valid_number(&c->schema->signals[i], n))
        return LVP_TYPE;
    v = &c->values[i];
    if (v->number != n || v->quality != q)
        c->dirty[i] = 1;
    v->number = n;
    v->quality = q;
    v->timestamp_ms = t;
    flush(c);
    return LVP_OK;
}
lvp_result lvp_set_string(lvp_context *c, uint32_t i, const char *text, uint64_t t, lvp_quality q) {
    lvp_value *v;
    if (!c || i >= c->schema->signal_count || !text || q > LVP_DISCONNECTED)
        return LVP_RANGE;
    if (c->schema->signals[i].code_count)
        return LVP_READONLY;
    if (c->schema->signals[i].type != LVP_STRING)
        return LVP_TYPE;
    if (strlen(text) > LVP_STRING_MAX)
        return LVP_RANGE;
    v = &c->values[i];
    if (strcmp(v->text, text) || v->quality != q)
        c->dirty[i] = 1;
    strcpy(v->text, text);
    v->timestamp_ms = t;
    v->quality = q;
    flush(c);
    return LVP_OK;
}
void lvp_batch_begin(lvp_context *c) {
    if (c)
        c->batch++;
}
void lvp_batch_end(lvp_context *c) {
    if (c && c->batch) {
        c->batch--;
        flush(c);
    }
}
lvp_subscription *lvp_subscribe(lvp_context *c, uint32_t i, lvp_observer_fn fn, void *u) {
    lvp_subscription *s;
    if (!c || i >= c->schema->signal_count || !fn)
        return NULL;
    s = allocate(c, sizeof(*s));
    if (!s)
        return NULL;
    s->signal = i;
    s->callback = fn;
    s->user = u;
    s->next = c->subscriptions;
    c->subscriptions = s;
    return s;
}
void lvp_unsubscribe(lvp_context *c, lvp_subscription *s) {
    lvp_subscription *it;
    if (!c || !s)
        return;
    for (it = c->subscriptions; it; it = it->next)
        if (it == s) {
            it->removed = 1;
            break;
        }
    if (!c->dispatching)
        sweep(c);
}
static lvp_result post(lvp_context *c, uint32_t i, const lvp_value *v, int is_event, uint32_t adapter) {
    uint32_t n;
    lvp_result result = LVP_OK;
    if (!c || !v || i >= c->schema->signal_count || v->quality > LVP_DISCONNECTED)
        return LVP_RANGE;
    if (c->schema->signals[i].code_count)
        return LVP_READONLY;
    if (c->schema->signals[i].type == LVP_STRING ? !memchr(v->text, 0, sizeof(v->text))
                                                 : !valid_number(&c->schema->signals[i], v->number))
        return LVP_TYPE;
    if (c->hal.lock)
        c->hal.lock(c->hal.user);
    if (adapter != UINT32_MAX &&
        (adapter >= c->adapter_count || c->adapters[adapter].info.state != LVP_ADAPTER_CONNECTED)) {
        result = LVP_READONLY;
        goto done;
    }
    if (!is_event)
        for (n = 0; n < c->queue_count; n++) {
            queue_item *item = &c->queue[(c->queue_head + n) % c->queue_size];
            if (item->signal == i && !item->is_event && item->adapter == adapter &&
                (adapter == UINT32_MAX || item->generation == c->adapters[adapter].generation)) {
                item->value = *v;
                c->stats.coalesced++;
                goto done;
            }
        }
    if (c->queue_count == c->queue_size) {
        c->stats.overflow++;
        result = LVP_FULL;
        goto done;
    }
    {
        queue_item *item = &c->queue[(c->queue_head + c->queue_count) % c->queue_size];
        item->signal = i;
        item->adapter = adapter;
        item->generation = adapter == UINT32_MAX ? 0 : c->adapters[adapter].generation;
        item->value = *v;
        item->is_event = is_event;
        c->queue_count++;
        c->stats.posted++;
    }
done:
    if (adapter < c->adapter_count) {
        if (result == LVP_OK)
            c->adapters[adapter].info.received++;
        else
            c->adapters[adapter].info.dropped++;
    }
    if (c->hal.unlock)
        c->hal.unlock(c->hal.user);
    return result;
}
lvp_result lvp_post(lvp_context *c, uint32_t i, const lvp_value *v, int is_event) {
    return post(c, i, v, is_event, UINT32_MAX);
}
lvp_queue_stats lvp_stats(lvp_context *c) {
    lvp_queue_stats s = {0};
    if (!c)
        return s;
    if (c->hal.lock)
        c->hal.lock(c->hal.user);
    s = c->stats;
    s.pending = c->queue_count;
    if (c->hal.unlock)
        c->hal.unlock(c->hal.user);
    return s;
}
void lvp_tick(lvp_context *c, uint64_t now) {
    uint32_t n, i;
    if (!c)
        return;
    if (c->dispatching) {
        if (c->hal.log)
            c->hal.log("lvp_tick cannot run inside an observer callback", c->hal.user);
        return;
    }
    c->now = now;
    lvp_batch_begin(c);
    for (i = 0; i < c->adapter_count; i++) {
        lvp_adapter_info info;
        lvp_adapter_get_info(c, i, &info);
        if ((info.state == LVP_ADAPTER_CONNECTING || info.state == LVP_ADAPTER_CONNECTED) &&
            c->adapters[i].ops.poll)
            c->adapters[i].ops.poll(c, i, now, c->adapters[i].user);
    }
    for (n = 0; n < c->queue_size; n++) {
        queue_item item;
        int found = 0;
        if (c->hal.lock)
            c->hal.lock(c->hal.user);
        if (c->queue_count) {
            item = c->queue[c->queue_head];
            c->queue_head = (c->queue_head + 1) % c->queue_size;
            c->queue_count--;
            c->stats.processed++;
            found = 1;
            if (item.adapter < c->adapter_count &&
                (item.generation != c->adapters[item.adapter].generation ||
                 c->adapters[item.adapter].info.state != LVP_ADAPTER_CONNECTED)) {
                c->adapters[item.adapter].info.dropped++;
                found = 2;
            }
        }
        if (c->hal.unlock)
            c->hal.unlock(c->hal.user);
        if (!found)
            break;
        if (found == 2)
            continue;
        uint32_t saved_batch = c->batch;
        if (item.is_event) {
            c->batch = 0;
            c->dirty[item.signal] = 1; /* Deliver even repeated equal-valued events. */
        }
        if (c->schema->signals[item.signal].type == LVP_STRING)
            lvp_set_string(c, item.signal, item.value.text, item.value.timestamp_ms, item.value.quality);
        else
            lvp_set_number(c, item.signal, item.value.number, item.value.timestamp_ms, item.value.quality);
        c->batch = saved_batch;
    }
    for (i = 0; i < c->schema->signal_count; i++) {
        const lvp_signal_def *d = &c->schema->signals[i];
        lvp_value *v = &c->values[i];
        if (!d->code_count && d->timeout_ms && v->quality == LVP_VALID && now >= v->timestamp_ms &&
            now - v->timestamp_ms >= d->timeout_ms) {
            v->quality = LVP_STALE;
            c->dirty[i] = 1;
        }
    }
    lvp_batch_end(c);
}
void lvp_disconnect(lvp_context *c, uint64_t now) {
    uint32_t i;
    if (!c)
        return;
    lvp_batch_begin(c);
    for (i = 0; i < c->schema->signal_count; i++)
        if (!c->schema->signals[i].code_count) {
            c->values[i].quality = LVP_DISCONNECTED;
            c->values[i].timestamp_ms = now;
            c->dirty[i] = 1;
        }
    lvp_batch_end(c);
}
void lvp_set_command_handler(lvp_context *c, lvp_command_fn fn, void *u) {
    if (c) {
        c->command_handler = fn;
        c->command_user = u;
    }
}
int32_t lvp_command(lvp_context *c, const char *name) {
    uint32_t i, id, attempt;
    command_entry *e;
    if (!c || !name)
        return LVP_NOT_FOUND;
    for (i = 0; i < c->schema->command_count; i++)
        if (!strcmp(c->schema->commands[i].name, name))
            break;
    if (i == c->schema->command_count)
        return LVP_NOT_FOUND;
    id = c->next_request;
    for (attempt = 0; attempt < 32; attempt++) {
        id++;
        if (!id || id > INT32_MAX)
            id = 1;
        e = &c->requests[id % 32];
        if (!e->id || e->status != LVP_COMMAND_PENDING)
            break;
    }
    if (attempt == 32)
        return LVP_FULL;
    c->next_request = id;
    e->id = id;
    e->status = LVP_COMMAND_PENDING;
    if (c->schema->commands[i].signal >= 0)
        e->status = lvp_set_number(c, (uint32_t)c->schema->commands[i].signal, c->schema->commands[i].value,
                                   c->now, LVP_VALID) == LVP_OK
                        ? LVP_COMMAND_SUCCEEDED
                        : LVP_COMMAND_FAILED;
    else {
        lvp_command_status returned =
            c->command_handler ? c->command_handler(name, id, c->command_user) : LVP_COMMAND_FAILED;
        if (returned != LVP_COMMAND_PENDING || e->status == LVP_COMMAND_PENDING)
            e->status = returned <= LVP_COMMAND_FAILED ? returned : LVP_COMMAND_FAILED;
    }
    return (int32_t)id;
}
lvp_result lvp_command_complete(lvp_context *c, uint32_t id, int success) {
    command_entry *e;
    if (!c || !id)
        return LVP_NOT_FOUND;
    e = &c->requests[id % 32];
    if (e->id != id || e->status != LVP_COMMAND_PENDING)
        return LVP_NOT_FOUND;
    e->status = success ? LVP_COMMAND_SUCCEEDED : LVP_COMMAND_FAILED;
    return LVP_OK;
}
lvp_command_status lvp_command_state(const lvp_context *c, uint32_t id) {
    if (!c || !id || c->requests[id % 32].id != id)
        return LVP_COMMAND_FAILED;
    return c->requests[id % 32].status;
}
int32_t lvp_adapter_register(lvp_context *c, const char *name, const lvp_adapter_ops *ops, void *user) {
    uint32_t i;
    adapter_entry *a;
    if (!c || !name || !name[0] || strlen(name) > 31 || !ops || !ops->start || !ops->stop)
        return LVP_ERROR;
    if (c->adapter_count == 8)
        return LVP_FULL;
    for (i = 0; i < c->adapter_count; i++)
        if (!strcmp(c->adapters[i].info.name, name))
            return LVP_ERROR;
    a = &c->adapters[c->adapter_count];
    a->ops = *ops;
    a->user = user;
    strcpy(a->info.name, name);
    return (int32_t)c->adapter_count++;
}
lvp_result lvp_adapter_set_state(lvp_context *c, uint32_t id, lvp_adapter_state state) {
    if (!c || id >= c->adapter_count || state == LVP_ADAPTER_STOPPED || (unsigned)state > LVP_ADAPTER_FAULT)
        return LVP_RANGE;
    if (c->hal.lock)
        c->hal.lock(c->hal.user);
    if (c->adapters[id].info.state == LVP_ADAPTER_STOPPED) {
        if (c->hal.unlock)
            c->hal.unlock(c->hal.user);
        return LVP_READONLY;
    }
    if (state == LVP_ADAPTER_FAULT)
        c->adapters[id].info.errors++;
    c->adapters[id].info.state = state;
    if (c->hal.unlock)
        c->hal.unlock(c->hal.user);
    return LVP_OK;
}
lvp_result lvp_adapter_get_info(lvp_context *c, uint32_t id, lvp_adapter_info *out) {
    if (!c || id >= c->adapter_count || !out)
        return LVP_RANGE;
    if (c->hal.lock)
        c->hal.lock(c->hal.user);
    *out = c->adapters[id].info;
    if (c->hal.unlock)
        c->hal.unlock(c->hal.user);
    return LVP_OK;
}
lvp_result lvp_adapter_start(lvp_context *c, uint32_t id) {
    lvp_adapter_info info;
    lvp_result result;
    if (lvp_adapter_get_info(c, id, &info) != LVP_OK)
        return LVP_RANGE;
    if (info.state == LVP_ADAPTER_CONNECTING || info.state == LVP_ADAPTER_CONNECTED)
        return LVP_ERROR;
    if (info.state == LVP_ADAPTER_FAULT)
        lvp_adapter_stop(c, id);
    if (c->hal.lock)
        c->hal.lock(c->hal.user);
    c->adapters[id].info.state = LVP_ADAPTER_CONNECTING;
    if (c->hal.unlock)
        c->hal.unlock(c->hal.user);
    result = c->adapters[id].ops.start(c, id, c->adapters[id].user);
    if (result != LVP_OK)
        lvp_adapter_set_state(c, id, LVP_ADAPTER_FAULT);
    return result;
}
void lvp_adapter_stop(lvp_context *c, uint32_t id) {
    lvp_adapter_info info;
    if (lvp_adapter_get_info(c, id, &info) != LVP_OK || info.state == LVP_ADAPTER_STOPPED)
        return;
    if (c->hal.lock)
        c->hal.lock(c->hal.user);
    c->adapters[id].generation++;
    c->adapters[id].info.state = LVP_ADAPTER_STOPPED;
    if (c->hal.unlock)
        c->hal.unlock(c->hal.user);
    c->adapters[id].ops.stop(c, id, c->adapters[id].user);
}
lvp_result lvp_adapter_publish(lvp_context *c, uint32_t id, uint32_t signal, const lvp_value *v,
                               int is_event) {
    if (!c || id >= c->adapter_count)
        return LVP_RANGE;
    return post(c, signal, v, is_event, id);
}
