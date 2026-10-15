/* SPDX-License-Identifier: Apache-2.0 */
#include "lvgl.h"
#include "lvglplus_ui.h"
#include <stdlib.h>
#include <string.h>
static lvp_package *package;
static lvp_context *context;
static lvp_ui *ui;
static int initialized;
static char last_error[256];
#ifdef LVP_CUSTOM
extern void lvp_register_custom_widgets(void);
#endif
int lvp_preview_load(const uint8_t *bytes, uint32_t length) {
    lvp_package *next;
    lvp_context *next_context;
    lvp_ui *next_ui;
    uint32_t i;
    if (!initialized) {
        lv_init();
#ifdef LVP_CUSTOM
        lvp_register_custom_widgets();
#endif
        initialized = 1;
    }
    next = lvp_package_load(bytes, length, last_error, sizeof(last_error));
    if (!next)
        return -1;
    next_context = lvp_create(lvp_package_schema(next), NULL);
    if (!next_context) {
        lvp_package_free(next);
        strcpy(last_error, "Cannot initialize model");
        return -1;
    }
    if (context) {
        const lvp_schema *schema = lvp_get_schema(next_context);
        lvp_batch_begin(next_context);
        for (i = 0; i < schema->signal_count; i++) {
            int32_t old = lvp_find(context, schema->signals[i].name);
            const lvp_value *v;
            if (old < 0 || schema->signals[i].code_count ||
                schema->signals[i].type != lvp_get_schema(context)->signals[old].type)
                continue;
            v = lvp_get(context, (uint32_t)old);
            if (schema->signals[i].type == LVP_STRING)
                lvp_set_string(next_context, i, v->text, v->timestamp_ms, v->quality);
            else
                lvp_set_number(next_context, i, v->number, v->timestamp_ms, v->quality);
        }
        lvp_batch_end(next_context);
    }
    next_ui = lvp_ui_create(next_context);
    if (!next_ui) {
        lvp_destroy(next_context);
        lvp_package_free(next);
        strcpy(last_error, "Cannot create LVGL view");
        return -1;
    }
    lvp_ui_destroy(ui);
    lvp_destroy(context);
    lvp_package_free(package);
    package = next;
    context = next_context;
    ui = next_ui;
    last_error[0] = 0;
    return 0;
}
void lvp_preview_tick(double now) {
    if (now >= 0)
        lvp_ui_tick(ui, (uint64_t)now);
}
const uint8_t *lvp_preview_pixels(void) {
    return lvp_ui_pixels(ui);
}
uint32_t lvp_preview_width(void) {
    return lvp_ui_width(ui);
}
uint32_t lvp_preview_height(void) {
    return lvp_ui_height(ui);
}
const char *lvp_preview_error(void) {
    return last_error;
}
uint32_t lvp_preview_signal_count(void) {
    return context ? lvp_get_schema(context)->signal_count : 0;
}
const char *lvp_preview_signal_name(uint32_t i) {
    return context && i < lvp_get_schema(context)->signal_count ? lvp_get_schema(context)->signals[i].name
                                                                : "";
}
uint32_t lvp_preview_signal_type(uint32_t i) {
    return context && i < lvp_get_schema(context)->signal_count ? lvp_get_schema(context)->signals[i].type
                                                                : 0;
}
double lvp_preview_number(uint32_t i) {
    const lvp_value *v = lvp_get(context, i);
    return v ? v->number : 0;
}
const char *lvp_preview_text(uint32_t i) {
    const lvp_value *v = lvp_get(context, i);
    return v ? v->text : "";
}
uint32_t lvp_preview_quality(uint32_t i) {
    const lvp_value *v = lvp_get(context, i);
    return v ? v->quality : LVP_INVALID;
}
int lvp_preview_set(uint32_t i, double value, double now, uint32_t quality) {
    return lvp_set_number(context, i, value, (uint64_t)now, (lvp_quality)quality);
}
int lvp_preview_set_text(uint32_t i, const char *value, double now, uint32_t quality) {
    return lvp_set_string(context, i, value, (uint64_t)now, (lvp_quality)quality);
}
void lvp_preview_begin(void) {
    lvp_batch_begin(context);
}
void lvp_preview_end(void) {
    lvp_batch_end(context);
}
void lvp_preview_disconnect(double now) {
    lvp_disconnect(context, (uint64_t)now);
}
void lvp_preview_pointer(int32_t x, int32_t y, int pressed) {
    lvp_ui_pointer(ui, x, y, pressed);
}
int lvp_preview_command(const char *name) {
    return lvp_command(context, name);
}
int lvp_preview_command_state(uint32_t id) {
    return lvp_command_state(context, id);
}
int lvp_preview_bounds(uint32_t node, int32_t *out) {
    return lvp_ui_bounds(ui, node, &out[0], &out[1], &out[2], &out[3]);
}
void lvp_preview_close(void) {
    lvp_ui_destroy(ui);
    lvp_destroy(context);
    lvp_package_free(package);
    ui = NULL;
    context = NULL;
    package = NULL;
}

int lvp_preview_locale(const char *locale) {
    return lvp_ui_locale(ui, locale);
}
void lvp_preview_restart_animations(void) {
    lvp_ui_restart_animations(ui);
}

int lvp_preview_hit_test(int32_t x, int32_t y) {
    return lvp_ui_hit_test(ui, x, y);
}
