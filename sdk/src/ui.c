/* SPDX-License-Identifier: Apache-2.0 */
#include "graphics.h"
#include "lvgl.h"
#include "src/misc/cache/instance/lv_image_cache.h"
#include "lvglplus_ui.h"
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
typedef struct binding_state binding_state;
typedef struct { uint64_t elapsed, previous; uint32_t frame; int playing, started;
    lv_image_dsc_t image; uint8_t *pixels;
} sequence_state;
static const lvp_application *application;
static char ui_error[256];
const char *lvp_ui_error(void) { return ui_error; }
lvp_result lvp_register_application(const lvp_application *app) {
    if (!app || !app->open || !app->close || application) return LVP_TYPE;
    application = app; return LVP_OK;
}
struct lvp_ui {
    lvp_context *context;
    const lvp_schema *schema;
    lv_display_t *display;
    lv_indev_t *input;
    lv_obj_t **objects, **labels;
    uint32_t *roots;
    lv_obj_t *previous_screen;
    uint8_t *pixels, *draw_buffer;
    int owns_display, applying;
    int32_t pointer_x, pointer_y;
    int pressed;
    uint64_t now, animation_epoch;
    int animation_started;
    binding_state *bindings;
    sequence_state *sequences;
    int32_t active_page;
    uint32_t navigation[32], navigation_count;
    lvp_ui_lifecycle_fn lifecycle;
    void *lifecycle_user;
    void *app_state;
    int app_opened;
};
struct binding_state {
    lvp_ui *ui;
    uint32_t node;
    const lvp_binding_def *definition;
    lvp_subscription *subscription;
    binding_state *next;
};
static const lvp_widget_factory *factories[16];
static uint32_t factory_count;
static struct {
    const char *name;
    const void *font;
} fonts[64];
static uint32_t font_count;
lvp_result lvp_ui_register_widget(const lvp_widget_factory *factory) {
    uint32_t i;
    if (!factory || factory->abi != LVP_WIDGET_ABI || !factory->name || !factory->create)
        return LVP_TYPE;
    for (i = 0; i < factory_count; i++)
        if (!strcmp(factories[i]->name, factory->name))
            return LVP_ERROR;
    if (factory_count == 16)
        return LVP_FULL;
    factories[factory_count++] = factory;
    return LVP_OK;
}
lvp_result lvp_ui_register_font(const char *name, const void *value) {
    uint32_t i;
    if (!name || !value)
        return LVP_TYPE;
    for (i = 0; i < font_count; i++)
        if (!strcmp(fonts[i].name, name))
            return LVP_ERROR;
    if (font_count == 64)
        return LVP_FULL;
    fonts[font_count].name = name;
    fonts[font_count++].font = value;
    return LVP_OK;
}
static const char *node_property(const lvp_node_def *node, const char *name) {
    uint32_t i;
    for (i = 0; i < node->property_count; i++)
        if (!strcmp(node->properties[i].name, name))
            return node->properties[i].value;
    return NULL;
}
static const lvp_widget_factory *node_factory(const lvp_node_def *node) {
    const char *name = node_property(node, "customType");
    uint32_t i;
    for (i = 0; name && i < factory_count; i++)
        if (!strcmp(factories[i]->name, name))
            return factories[i];
    return NULL;
}
static uint32_t clock_ms;
static uint32_t tick_clock(void) {
    return clock_ms;
}
static uint32_t color(const char *s) {
    return s && s[0] == '#' ? (uint32_t)strtoul(s + 1, NULL, 16) : 0;
}
static int32_t size_value(const char *s) {
    size_t n = strlen(s);
    if (!strcmp(s, "content"))
        return LV_SIZE_CONTENT;
    if (n && s[n - 1] == '%')
        return LV_PCT(atoi(s));
    return atoi(s);
}
static const lv_font_t *font(int n) {
    switch (n) {
    case 20:
        return &lv_font_montserrat_20;
    case 28:
        return &lv_font_montserrat_28;
    case 40:
        return &lv_font_montserrat_40;
    case 48:
        return &lv_font_montserrat_48;
    default:
        return &lv_font_montserrat_14;
    }
}
static void flush_display(lv_display_t *display, const lv_area_t *area, uint8_t *pixels) {
    lvp_ui *ui = lv_display_get_user_data(display);
    int32_t y;
    uint32_t width = lv_area_get_width(area);
    for (y = area->y1; y <= area->y2; y++)
        memcpy(ui->pixels + ((size_t)y * ui->schema->width + area->x1) * 4,
               pixels + (size_t)(y - area->y1) * width * 4, width * 4);
    lv_display_flush_ready(display);
}
static void read_pointer(lv_indev_t *input, lv_indev_data_t *data) {
    lvp_ui *ui = lv_indev_get_user_data(input);
    data->point.x = ui->pointer_x;
    data->point.y = ui->pointer_y;
    data->state = ui->pressed ? LV_INDEV_STATE_PRESSED : LV_INDEV_STATE_RELEASED;
}
/* Interpret a safe single-placeholder format; never pass project input as a printf format. */
static void format_value(char *out, size_t cap, const char *fmt, const lvp_value *v, int is_string) {
    size_t used = 0;
    int replaced = 0;
    if (!fmt || !fmt[0])
        fmt = is_string ? "%s" : "%.0f";
    while (*fmt && used + 1 < cap) {
        if (*fmt != '%') {
            out[used++] = *fmt++;
            continue;
        }
        fmt++;
        if (*fmt == '%') {
            out[used++] = '%';
            fmt++;
            continue;
        }
        {
            char piece[320];
            int precision = 0;
            if (replaced++) {
                snprintf(out, cap, "<format error>");
                return;
            }
            if (*fmt == '.') {
                fmt++;
                while (*fmt >= '0' && *fmt <= '9') {
                    precision = precision * 10 + (*fmt++ - '0');
                    if (precision > 6) {
                        snprintf(out, cap, "<format error>");
                        return;
                    }
                }
            }
            if (*fmt == 's' && is_string)
                snprintf(piece, sizeof(piece), "%s", v->text);
            else if ((*fmt == 'd' || *fmt == 'f') && !is_string)
                snprintf(piece, sizeof(piece), "%.*f", *fmt == 'd' ? 0 : precision,
                         *fmt == 'd' ? trunc(v->number) : v->number);
            else {
                snprintf(out, cap, "<format error>");
                return;
            }
            fmt++;
            {
                size_t len = strlen(piece);
                if (len > cap - used - 1)
                    len = cap - used - 1;
                memcpy(out + used, piece, len);
                used += len;
            }
        }
    }
    out[used] = 0;
}
static void property(lvp_ui *ui, uint32_t index, const char *name, const char *value);
static int image_source(lvp_ui *ui, uint32_t index, double frame) {
    char key[32];
    const char *path;
    if (!isfinite(frame) || frame < 0 || frame > 511 || floor(frame) != frame || !ui->objects[index]) return 0;
    snprintf(key, sizeof(key), "source.%u", (unsigned)frame);
    path = node_property(&ui->schema->nodes[index], key);
    if (!path) return 0;
    lv_image_set_src(ui->objects[index], path);
    ui->sequences[index].frame = (uint32_t)frame;
    return 1;
}
static void apply_binding(lvp_context *ctx, uint32_t signal, const lvp_value *value, void *user) {
    binding_state *b = user;
    lvp_ui *ui = b->ui;
    const lvp_binding_def *d = b->definition;
    lv_obj_t *obj = ui->objects[b->node];
    char text[384];
    if (!obj) return;
    ui->applying++;
    if (d->property == LVP_BIND_SOURCE || d->property == LVP_BIND_PLAYING) {
        if (value->quality == LVP_VALID && isfinite(value->number)) {
            if (d->property == LVP_BIND_SOURCE) image_source(ui, b->node, value->number);
            else ui->sequences[b->node].playing = value->number != 0;
        }
        ui->applying--;
        return;
    }
    if (d->property >= LVP_BIND_X) {
        static const char *names[] = {"x",      "y",       "width", "height",     "rotation", "scaleX",
                                      "scaleY", "opacity", "bg",    "startAngle", "endAngle", "lineWidth"};
        if (value->quality != LVP_VALID || !isfinite(value->number)) {
            ui->applying--;
            return;
        }
        if (d->property >= LVP_BIND_POINT_BASE) {
            if (ui->schema->nodes[b->node].kind == 9 || ui->schema->nodes[b->node].kind == 10)
                lvp_graphic_point(obj, (d->property - LVP_BIND_POINT_BASE) / 2,
                                  (d->property - LVP_BIND_POINT_BASE) % 2, value->number);
        } else if (d->property - LVP_BIND_X < sizeof(names) / sizeof(names[0])) {
            if (d->property == LVP_BIND_BG)
                snprintf(text, sizeof(text), "#%06x", (unsigned)fmax(0, fmin(0xffffff, value->number)));
            else
                snprintf(text, sizeof(text), "%.6f", fmax(-32767, fmin(32767, value->number)));
            property(ui, b->node, names[d->property - LVP_BIND_X], text);
        }
        ui->applying--;
        return;
    }
    switch (d->property) {
    case LVP_BIND_TEXT:
        if (value->quality != LVP_VALID)
            strcpy(text, "--");
        else
            format_value(text, sizeof(text), d->format, value,
                         ui->schema->signals[signal].type == LVP_STRING);
        if (ui->labels[b->node])
            lv_label_set_text(ui->labels[b->node], text);
        else if (ui->schema->nodes[b->node].kind == 8) {
            const lvp_widget_factory *f = node_factory(&ui->schema->nodes[b->node]);
            if (f && f->property)
                f->property(obj, "text", text);
        }
        break;
    case LVP_BIND_VALUE:
        if (value->number >= INT32_MIN && value->number <= INT32_MAX) {
            int32_t n = (int32_t)value->number;
            if (ui->schema->nodes[b->node].kind == 3)
                lv_bar_set_value(obj, n, LV_ANIM_OFF);
            else if (ui->schema->nodes[b->node].kind == 4)
                lv_slider_set_value(obj, n, LV_ANIM_OFF);
            else if (ui->schema->nodes[b->node].kind == 5)
                lv_arc_set_value(obj, n);
            else if (ui->schema->nodes[b->node].kind == 8) {
                const lvp_widget_factory *f = node_factory(&ui->schema->nodes[b->node]);
                snprintf(text, sizeof(text), "%d", n);
                if (f && f->property)
                    f->property(obj, "value", text);
            }
        }
        lv_obj_set_style_opa(obj, value->quality == LVP_VALID ? LV_OPA_COVER : LV_OPA_40, 0);
        break;
    case LVP_BIND_CHECKED:
        if (value->number)
            lv_obj_add_state(obj, LV_STATE_CHECKED);
        else
            lv_obj_remove_state(obj, LV_STATE_CHECKED);
        break;
    case LVP_BIND_HIDDEN:
        if (value->number)
            lv_obj_add_flag(obj, LV_OBJ_FLAG_HIDDEN);
        else
            lv_obj_remove_flag(obj, LV_OBJ_FLAG_HIDDEN);
        break;
    case LVP_BIND_COLOR:
        if (value->number >= 0 && value->number <= 0xffffff) {
            lv_obj_set_style_text_color(obj, lv_color_hex((uint32_t)value->number), 0);
            if (ui->schema->nodes[b->node].kind >= 9) {
                snprintf(text, sizeof(text), "#%06x", (unsigned)value->number);
                lvp_graphic_property(obj, "color", text);
            }
        }
        break;
    case LVP_BIND_QUALITY: {
        static const char *q[] = {"LIVE", "STALE", "INVALID", "OFFLINE"};
        if (ui->labels[b->node])
            lv_label_set_text(ui->labels[b->node], q[value->quality]);
        else if (ui->schema->nodes[b->node].kind == 8) {
            const lvp_widget_factory *factory = node_factory(&ui->schema->nodes[b->node]);
            if (factory && factory->property)
                factory->property(obj, "quality", q[value->quality]);
        }
        break;
    }
    default:
        break;
    }
    ui->applying--;
    (void)ctx;
}
static void write_binding(lv_event_t *event) {
    binding_state *b = lv_event_get_user_data(event);
    double n;
    if (b->ui->applying)
        return;
    if (b->definition->property == LVP_BIND_CHECKED)
        n = lv_obj_has_state(b->ui->objects[b->node], LV_STATE_CHECKED) ? 1 : 0;
    else
        n = lv_slider_get_value(b->ui->objects[b->node]);
    lvp_set_number(b->ui->context, b->definition->signal, n, lvp_now(b->ui->context), LVP_VALID);
}
static void click_node(lv_event_t *event) {
    binding_state *b = lv_event_get_user_data(event);
    const lvp_node_def *node = &b->ui->schema->nodes[b->node];
    uint32_t i;
    if (node->command && node->command[0]) {
        const char *argument = node_property(node, "command.argument"),
                   *signal = node_property(node, "command.argumentSignal");
        if (argument)
            lvp_command_number(b->ui->context, node->command, strtod(argument, NULL));
        else if (signal) {
            int32_t index = atoi(signal);
            const lvp_value *value = index < 0 ? NULL : lvp_get(b->ui->context, (uint32_t)index);
            if (value && value->quality == LVP_VALID)
                lvp_command_number(b->ui->context, node->command, value->number);
        } else
            lvp_command(b->ui->context, node->command);
    }
    for (i = 0; i < node->property_count; i++)
        if (!strcmp(node->properties[i].name, "navigate"))
            lvp_ui_navigate(b->ui, node->properties[i].value);
}
static void property(lvp_ui *ui, uint32_t index, const char *name, const char *value) {
    lv_obj_t *obj = ui->objects[index];
    uint32_t kind = ui->schema->nodes[index].kind;
    double numeric = strtod(value, NULL);
    int32_t n = (int32_t)fmax(-32767, fmin(32767, isfinite(numeric) ? numeric : 0));
    if (kind >= 9 && lvp_graphic_property(obj, name, value))
        return;
    if (!strcmp(name, "rotation"))
        lv_obj_set_style_transform_rotation(
            obj, (int32_t)lround(fmax(-32767, fmin(32767, isfinite(numeric) ? numeric : 0)) * 10), 0);
    else if (!strcmp(name, "scaleX"))
        lv_obj_set_style_transform_scale_x(obj, (int32_t)fmax(0, n), 0);
    else if (!strcmp(name, "scaleY"))
        lv_obj_set_style_transform_scale_y(obj, (int32_t)fmax(0, n), 0);
    else if (!strcmp(name, "pivotX"))
        lv_obj_set_style_transform_pivot_x(obj, n, 0);
    else if (!strcmp(name, "pivotY"))
        lv_obj_set_style_transform_pivot_y(obj, n, 0);
    else if (!strcmp(name, "clip")) {
        if (!strcmp(value, "false"))
            lv_obj_add_flag(obj, LV_OBJ_FLAG_OVERFLOW_VISIBLE);
        else
            lv_obj_remove_flag(obj, LV_OBJ_FLAG_OVERFLOW_VISIBLE);
    } else if (!strcmp(name, "bgEnd"))
        lv_obj_set_style_bg_grad_color(obj, lv_color_hex(color(value)), 0);
    else if (!strcmp(name, "gradientDirection"))
        lv_obj_set_style_bg_grad_dir(obj, !strcmp(value, "horizontal") ? LV_GRAD_DIR_HOR : LV_GRAD_DIR_VER,
                                     0);
    else if (!strcmp(name, "x"))
        lv_obj_set_x(obj, n);
    else if (!strcmp(name, "y"))
        lv_obj_set_y(obj, n);
    else if (!strcmp(name, "width"))
        lv_obj_set_width(obj, size_value(value));
    else if (!strcmp(name, "height"))
        lv_obj_set_height(obj, size_value(value));
    else if (!strcmp(name, "bg")) {
        lv_obj_set_style_bg_color(obj, lv_color_hex(color(value)), 0);
        {
            const char *opacity = node_property(&ui->schema->nodes[index], "bgOpacity");
            lv_obj_set_style_bg_opa(obj, opacity ? (lv_opa_t)atoi(opacity) : LV_OPA_COVER, 0);
        }
    } else if (!strcmp(name, "bgOpacity"))
        lv_obj_set_style_bg_opa(obj, (lv_opa_t)fmax(0, fmin(255, n)), 0);
    else if (!strcmp(name, "color")) {
        lv_color_t c = lv_color_hex(color(value));
        lv_obj_set_style_text_color(obj, c, 0);
        if (kind == 3 || kind == 4 || kind == 6)
            lv_obj_set_style_bg_color(obj, c, LV_PART_INDICATOR);
        if (kind == 5)
            lv_obj_set_style_arc_color(obj, c, LV_PART_INDICATOR);
    } else if (!strcmp(name, "radius"))
        lv_obj_set_style_radius(obj, n, 0);
    else if (!strcmp(name, "padding"))
        lv_obj_set_style_pad_all(obj, n, 0);
    else if (!strcmp(name, "gap")) {
        lv_obj_set_style_pad_row(obj, n, 0);
        lv_obj_set_style_pad_column(obj, n, 0);
    } else if (!strcmp(name, "direction"))
        lv_obj_set_flex_flow(obj, !strcmp(value, "row") ? LV_FLEX_FLOW_ROW : LV_FLEX_FLOW_COLUMN);
    else if (!strcmp(name, "align")) {
        lv_align_t align = LV_ALIGN_CENTER;
        if (!strcmp(value, "top-left"))
            align = LV_ALIGN_TOP_LEFT;
        else if (!strcmp(value, "top-right"))
            align = LV_ALIGN_TOP_RIGHT;
        else if (!strcmp(value, "bottom-left"))
            align = LV_ALIGN_BOTTOM_LEFT;
        else if (!strcmp(value, "bottom-right"))
            align = LV_ALIGN_BOTTOM_RIGHT;
        lv_obj_set_align(obj, align);
    } else if (!strcmp(name, "fontSize"))
        lv_obj_set_style_text_font(obj, font(n), 0);
    else if (!strcmp(name, "font")) {
        uint32_t i;
        for (i = 0; i < font_count; i++)
            if (!strcmp(fonts[i].name, value))
                lv_obj_set_style_text_font(obj, fonts[i].font, 0);
    } else if (!strcmp(name, "textAlign"))
        lv_obj_set_style_text_align(obj,
                                    !strcmp(value, "center")  ? LV_TEXT_ALIGN_CENTER
                                    : !strcmp(value, "right") ? LV_TEXT_ALIGN_RIGHT
                                                              : LV_TEXT_ALIGN_LEFT,
                                    0);
    else if (!strcmp(name, "textMode") && ui->labels[index])
        lv_label_set_long_mode(ui->labels[index], !strcmp(value,"clip") ? LV_LABEL_LONG_CLIP :
            !strcmp(value,"ellipsis") ? LV_LABEL_LONG_DOT : !strcmp(value,"scroll") ? LV_LABEL_LONG_SCROLL :
            !strcmp(value,"scroll-circular") ? LV_LABEL_LONG_SCROLL_CIRCULAR : LV_LABEL_LONG_WRAP);
    else if (!strcmp(name, "text") && ui->labels[index])
        lv_label_set_text(ui->labels[index], value);
    else if (!strcmp(name, "hidden") && !strcmp(value, "true"))
        lv_obj_add_flag(obj, LV_OBJ_FLAG_HIDDEN);
    else if (!strcmp(name, "border"))
        lv_obj_set_style_border_width(obj, n, 0);
    else if (!strcmp(name, "borderColor"))
        lv_obj_set_style_border_color(obj, lv_color_hex(color(value)), 0);
    else if (!strcmp(name, "opacity"))
        lv_obj_set_style_opa(obj, (lv_opa_t)fmax(0, fmin(255, n)), 0);
    else if (!strcmp(name, "grow"))
        lv_obj_set_flex_grow(obj, (uint8_t)n);
    else if (!strcmp(name, "value")) {
        if (kind == 3)
            lv_bar_set_value(obj, n, LV_ANIM_OFF);
        else if (kind == 4)
            lv_slider_set_value(obj, n, LV_ANIM_OFF);
        else if (kind == 5)
            lv_arc_set_value(obj, n);
    } else if (!strcmp(name, "src") && kind == 7)
        lv_image_set_src(obj, value);
    else if (kind == 8) {
        const lvp_widget_factory *f = node_factory(&ui->schema->nodes[index]);
        if (f && f->property)
            f->property(obj, name, value);
    }
}
static void release_page(lvp_ui *ui, uint32_t root) {
    uint32_t i;
    binding_state **link = &ui->bindings;
    while (*link) {
        binding_state *b = *link;
        if (ui->roots[b->node] == root) {
            if (b->subscription) lvp_unsubscribe(ui->context, b->subscription);
            *link = b->next; free(b);
        } else link = &b->next;
    }
    if (ui->objects[root]) {
        if (ui->lifecycle) ui->lifecycle(ui, ui->schema->nodes[root].id, LVP_UI_DESTROY, ui->lifecycle_user);
        lv_obj_delete(ui->objects[root]);
    }
    for (i = root; i < ui->schema->node_count; i++) if (ui->roots[i] == root) {
        ui->objects[i] = ui->labels[i] = NULL;
        if (ui->sequences[i].pixels) lv_image_cache_drop(&ui->sequences[i].image);
        free(ui->sequences[i].pixels);
        memset(&ui->sequences[i], 0, sizeof(sequence_state));
    }
}
static int create_page(lvp_ui *ui, uint32_t root) {
    uint32_t i, j;
    if (ui->objects[root]) return 1;
    for (i = root; i < ui->schema->node_count; i++) {
        if (ui->roots[i] != root) continue;
        const lvp_node_def *d = &ui->schema->nodes[i];
        lv_obj_t *parent = d->parent < 0 ? NULL : ui->objects[d->parent];
        lv_obj_t *obj = NULL;
        int min = 0, max = 100;
        if (!parent)
            obj = lv_obj_create(NULL);
        else
            switch (d->kind) {
            case 0:
                obj = lv_obj_create(parent);
                break;
            case 1:
                obj = lv_label_create(parent);
                break;
            case 2:
                obj = lv_button_create(parent);
                break;
            case 3:
                obj = lv_bar_create(parent);
                break;
            case 4:
                obj = lv_slider_create(parent);
                break;
            case 5:
                obj = lv_arc_create(parent);
                break;
            case 6:
                obj = lv_switch_create(parent);
                break;
            case 7:
                obj = lv_image_create(parent);
                break;
            case 8: {
                const lvp_widget_factory *factory = node_factory(d);
                if (factory)
                    obj = factory->create(parent);
                break;
            }
            case 9:
            case 10:
            case 11:
            case 12:
                obj = lvp_graphic_create(parent, d->kind);
                break;
            default:
                return 0;
            }
        if (!obj) { snprintf(ui_error, sizeof(ui_error), "Cannot create node %s", d->id); return 0; }
        ui->objects[i] = obj;
        ui->sequences[i].playing = 1;
        if (d->kind == 0) {
            lv_obj_set_style_border_width(obj, 0, 0);
            lv_obj_set_style_pad_all(obj, 0, 0);
            lv_obj_set_style_radius(obj, 0, 0);
            lv_obj_remove_flag(obj, LV_OBJ_FLAG_SCROLLABLE);
        }
        if (d->kind == 1)
            ui->labels[i] = obj;
        else if (d->kind == 2) {
            ui->labels[i] = lv_label_create(obj);
            lv_obj_center(ui->labels[i]);
            lv_label_set_text(ui->labels[i], "");
        }
        if (d->kind == 5) {
            lv_obj_remove_style(obj, NULL, LV_PART_KNOB);
            lv_obj_remove_flag(obj, LV_OBJ_FLAG_CLICKABLE);
            lv_arc_set_bg_angles(obj, 135, 405);
            lv_obj_set_style_arc_color(obj, lv_color_hex(0x25354b), LV_PART_MAIN);
        }
        for (j = 0; j < d->property_count; j++) {
            const char *k = d->properties[j].name;
            int n = atoi(d->properties[j].value);
            if (!strcmp(k, "min"))
                min = n;
            else if (!strcmp(k, "max"))
                max = n;
        }
        if (min >= max)
            return 0;
        if (d->kind == 3)
            lv_bar_set_range(obj, min, max);
        else if (d->kind == 4)
            lv_slider_set_range(obj, min, max);
        else if (d->kind == 5)
            lv_arc_set_range(obj, min, max);
        for (j = 0; j < d->property_count; j++) {
            const char *k = d->properties[j].name;
            if (!strcmp(k, "font")) {
                uint32_t f;
                int found = 0;
                for (f = 0; f < font_count; f++)
                    if (!strcmp(fonts[f].name, d->properties[j].value))
                        found = 1;
                if (!found) { snprintf(ui_error, sizeof(ui_error), "Unregistered font %s on %s", d->properties[j].value, d->id); return 0; }
            }
            property(ui, i, k, d->properties[j].value);
        }
        {
            const char *locale = node_property(d, "locale");
            char key[32];
            const char *translated;
            if (locale && ui->labels[i]) {
                snprintf(key, sizeof(key), "l10n.%s", locale);
                translated = node_property(d, key);
                if (translated)
                    lv_label_set_text(ui->labels[i], translated);
            }
        }
        if (d->kind == 5) {
            int start = 135, end = 405;
            for (j = 0; j < d->property_count; j++) {
                if (!strcmp(d->properties[j].name, "startAngle"))
                    start = atoi(d->properties[j].value);
                if (!strcmp(d->properties[j].name, "endAngle"))
                    end = atoi(d->properties[j].value);
            }
            lv_arc_set_bg_angles(obj, (uint32_t)start, (uint32_t)end);
        }
        for (j = 0; j < d->binding_count; j++) {
            binding_state *b = calloc(1, sizeof(*b));
            if (!b)
                return 0;
            b->ui = ui;
            b->node = i;
            b->definition = &d->bindings[j];
            b->next = ui->bindings;
            ui->bindings = b;
            b->subscription = lvp_subscribe(ui->context, b->definition->signal, apply_binding, b);
            if (!b->subscription)
                return 0;
            apply_binding(ui->context, b->definition->signal, lvp_get(ui->context, b->definition->signal), b);
            if (b->definition->two_way)
                lv_obj_add_event_cb(obj, write_binding, LV_EVENT_VALUE_CHANGED, b);
        }
        if (d->kind == 2 || d->kind == 8 || (d->command && d->command[0])) {
            lv_obj_add_flag(obj, LV_OBJ_FLAG_CLICKABLE);
            binding_state *b = calloc(1, sizeof(*b));
            if (!b)
                return 0;
            b->ui = ui;
            b->node = i;
            b->next = ui->bindings;
            ui->bindings = b;
            lv_obj_add_event_cb(obj, click_node, LV_EVENT_CLICKED, b);
        }
    }
    if (ui->lifecycle) ui->lifecycle(ui, ui->schema->nodes[root].id, LVP_UI_CREATE, ui->lifecycle_user);
    return 1;
}
static int make_objects(lvp_ui *ui) {
    uint32_t i;
    ui->active_page = -1;
    ui->objects = calloc(ui->schema->node_count, sizeof(lv_obj_t *));
    ui->labels = calloc(ui->schema->node_count, sizeof(lv_obj_t *));
    ui->sequences = calloc(ui->schema->node_count, sizeof(sequence_state));
    ui->roots = calloc(ui->schema->node_count, sizeof(uint32_t));
    ui_error[0] = 0;
    if (!ui->objects || !ui->labels || !ui->sequences || !ui->roots) { strcpy(ui_error, "Object table allocation failed"); return 0; }
    for (i = 0; i < ui->schema->node_count; i++) {
        int32_t parent = ui->schema->nodes[i].parent;
        if (parent >= (int32_t)i) { strcpy(ui_error, "Parent must precede its child"); return 0; }
        ui->roots[i] = parent < 0 ? i : ui->roots[parent];
    }
    for (i = 0; i < ui->schema->node_count; i++)
        if (ui->schema->nodes[i].parent < 0 &&
            (!node_property(&ui->schema->nodes[i], "lazy") || strcmp(node_property(&ui->schema->nodes[i], "lazy"), "true")) && !create_page(ui, i)) return 0;
    return lvp_ui_navigate(ui, ui->schema->initial_page) == LVP_OK;
}
static lvp_ui *base_ui(lvp_context *ctx) {
    lvp_ui *ui;
    if (!ctx)
        return NULL;
    ui = calloc(1, sizeof(*ui));
    if (ui) {
        ui->context = ctx;
        ui->schema = lvp_get_schema(ctx);
    }
    return ui;
}
lvp_ui *lvp_ui_create(lvp_context *ctx) {
    lvp_ui *ui = base_ui(ctx);
    size_t bytes;
    if (!ui)
        return NULL;
    bytes = (size_t)ui->schema->width * ui->schema->height * 4;
    ui->pixels = calloc(1, bytes);
    ui->draw_buffer = calloc(1, (size_t)ui->schema->width * 32 * 4);
    if (!ui->pixels || !ui->draw_buffer) {
        lvp_ui_destroy(ui);
        return NULL;
    }
    ui->display = lv_display_create((int32_t)ui->schema->width, (int32_t)ui->schema->height);
    ui->owns_display = 1;
    if (!ui->display) {
        lvp_ui_destroy(ui);
        return NULL;
    }
    lv_display_set_default(ui->display);
    lv_display_set_user_data(ui->display, ui);
    lv_display_set_color_format(ui->display, LV_COLOR_FORMAT_ARGB8888);
    lv_display_set_buffers(ui->display, ui->draw_buffer, NULL, ui->schema->width * 32 * 4,
                           LV_DISPLAY_RENDER_MODE_PARTIAL);
    lv_display_set_flush_cb(ui->display, flush_display);
    ui->input = lv_indev_create();
    lv_indev_set_type(ui->input, LV_INDEV_TYPE_POINTER);
    lv_indev_set_display(ui->input, ui->display);
    lv_indev_set_user_data(ui->input, ui);
    lv_indev_set_read_cb(ui->input, read_pointer);
    if (!make_objects(ui)) {
        lvp_ui_destroy(ui);
        return NULL;
    }
    if (application) {
        if (application->open(ctx, ui, &ui->app_state) != LVP_OK) { lvp_ui_destroy(ui); return NULL; }
        ui->app_opened = 1;
    }
    return ui;
}
lvp_ui *lvp_ui_attach(lvp_context *ctx, void *display) {
    lvp_ui *ui;
    if (!display)
        return NULL;
    ui = base_ui(ctx);
    if (!ui)
        return NULL;
    ui->display = display;
    if ((uint32_t)lv_display_get_horizontal_resolution(ui->display) != ui->schema->width ||
        (uint32_t)lv_display_get_vertical_resolution(ui->display) != ui->schema->height) {
        free(ui);
        return NULL;
    }
    ui->previous_screen = lv_display_get_screen_active(ui->display);
    lv_display_set_default(ui->display);
    if (!make_objects(ui)) {
        lvp_ui_destroy(ui);
        return NULL;
    }
    if (application) {
        if (application->open(ctx, ui, &ui->app_state) != LVP_OK) { lvp_ui_destroy(ui); return NULL; }
        ui->app_opened = 1;
    }
    return ui;
}
void lvp_ui_destroy(lvp_ui *ui) {
    uint32_t i;
    binding_state *b;
    if (!ui)
        return;
    if (ui->lifecycle && ui->objects) {
        if (ui->active_page >= 0 && ui->objects[ui->active_page])
            ui->lifecycle(ui, ui->schema->nodes[ui->active_page].id, LVP_UI_LEAVE, ui->lifecycle_user);
        for (i = 0; i < ui->schema->node_count; i++) if (ui->schema->nodes[i].parent < 0 && ui->objects[i])
            ui->lifecycle(ui, ui->schema->nodes[i].id, LVP_UI_DESTROY, ui->lifecycle_user);
    }
    if (ui->app_opened) application->close(ui->context, ui, ui->app_state);
    b = ui->bindings;
    while (b) {
        binding_state *next = b->next;
        if (b->subscription)
            lvp_unsubscribe(ui->context, b->subscription);
        free(b);
        b = next;
    }
    if (ui->input)
        lv_indev_delete(ui->input);
    if (ui->display && ui->owns_display)
        lv_display_delete(ui->display);
    else if (ui->objects) {
        if (ui->previous_screen && lv_obj_is_valid(ui->previous_screen))
            lv_screen_load(ui->previous_screen);
        for (i = 0; i < ui->schema->node_count; i++)
            if (ui->schema->nodes[i].parent < 0 && ui->objects[i])
                lv_obj_delete(ui->objects[i]);
    }
    if (ui->sequences) for (i = 0; i < ui->schema->node_count; i++) {
        if (ui->sequences[i].pixels) lv_image_cache_drop(&ui->sequences[i].image);
        free(ui->sequences[i].pixels);
    }
    free(ui->roots);
    free(ui->sequences);
    free(ui->objects);
    free(ui->labels);
    free(ui->pixels);
    free(ui->draw_buffer);
    free(ui);
}
static double ease_value(double t, int easing, double x1, double y1, double x2, double y2) {
    if (easing == 1) return t*t*(3-2*t);
    if (easing == 2) return t < 1 ? 0 : 1;
    if (easing == 3) return t*t;
    if (easing == 4) return 1-(1-t)*(1-t);
    if (easing == 5) {
        double low=0,high=1,u=t;
        int i;
        for(i=0;i<32;i++) {
            double v=1-u,x=3*v*v*u*x1+3*v*u*u*x2+u*u*u;
            if(x<t)low=u;else high=u;
            u=(low+high)*0.5;
        }
        return 3*(1-u)*(1-u)*u*y1+3*(1-u)*u*u*y2+u*u*u;
    }
    return t;
}
static int timeline_value(const char *data, uint64_t elapsed, double *result) {
    const char *first=strchr(data,';'), *cursor;
    int repeat, easing=0;
    long parsed_repeat=strtol(data,NULL,10);
    if(parsed_repeat < -1 || parsed_repeat > 1000000) return 0;
    repeat=(int)parsed_repeat;
    double end=0, at=0, value=0, previous_at=0, previous_value=0,x1,y1,x2,y2;
    if (!first || repeat < -1) return 0;
    for(cursor=first;cursor;cursor=strchr(cursor+1,';')) end=strtod(cursor+1,NULL);
    if(!isfinite(end) || end<1 || end>3600000) return 0;
    if(repeat<0 || (double)elapsed < end*(repeat+1.0)) elapsed=(uint64_t)fmod((double)elapsed,end);
    else elapsed=(uint64_t)end;
    for(cursor=first;cursor;cursor=strchr(cursor+1,';')) {
        if(sscanf(cursor+1,"%lf,%lf,%d,%lf,%lf,%lf,%lf",&at,&value,&easing,&x1,&y1,&x2,&y2)!=7) return 0;
        if(!isfinite(at) || !isfinite(value) || at<previous_at || at>end || fabs(value)>32767 ||
           easing<0 || easing>5 || !isfinite(x1) || !isfinite(y1) || !isfinite(x2) || !isfinite(y2) ||
           x1<0 || x1>1 || x2<0 || x2>1 || fabs(y1)>8 || fabs(y2)>8) return 0;
        if(at>=(double)elapsed) {
            double t=at==previous_at?1:((double)elapsed-previous_at)/(at-previous_at);
            *result=previous_value+(value-previous_value)*ease_value(t,easing,x1,y1,x2,y2);return 1;
        }
        previous_at=at;previous_value=value;
    }
    *result=value;return 1;
}
void lvp_ui_tick(lvp_ui *ui, uint64_t now) {
    if (!ui)
        return;
    ui->now = now;
    if (ui->app_opened && application->tick) application->tick(ui->context, ui, now, ui->app_state);
    {
        uint32_t i, page = 0;
        for (i = 0; i < ui->schema->node_count; i++) if (ui->schema->nodes[i].parent < 0) {
            const char *selector = node_property(&ui->schema->nodes[i], "pageSignal");
            const lvp_value *v = selector ? lvp_get(ui->context, (uint32_t)atoi(selector)) : NULL;
            if (v && v->quality == LVP_VALID && v->number == page && ui->active_page != (int32_t)i)
                lvp_ui_navigate(ui, ui->schema->nodes[i].id);
            page++;
        }
    }
    if (ui->owns_display) {
        clock_ms = (uint32_t)now;
        lv_tick_set_cb(tick_clock);
    }
    if (!ui->animation_started || now < ui->animation_epoch) {
        ui->animation_epoch = now;
        ui->animation_started = 1;
    }
    {
        uint32_t i, j;
        for (i = 0; i < ui->schema->node_count; i++) {
            const lvp_node_def *d = &ui->schema->nodes[i];
            const char *sequence = node_property(d, "sequence");
            if (!ui->objects[i]) continue;
            if (sequence && d->kind == 7) {
                int ms, repeat;
                uint32_t frames = 0, k;
                sequence_state *state = &ui->sequences[i];
                for (k = 0; k < d->property_count; k++) if (!strncmp(d->properties[k].name, "source.", 7)) frames++;
                if (state->started && now < state->previous) state->elapsed = 0;
                if (state->started && now >= state->previous && state->playing && lv_obj_is_visible(ui->objects[i])) state->elapsed += now - state->previous;
                state->started = 1; state->previous = now;
                if (frames && sscanf(sequence, "%d,%d", &ms, &repeat) == 2 && ms > 0) {
                    uint64_t frame = state->elapsed / (uint32_t)ms;
                    if (repeat >= 0 && frame / frames > (uint32_t)repeat) frame = frames - 1;
                    else frame %= frames;
                    image_source(ui, i, (double)frame);
                }
            }
            for (j = 0; j < d->property_count; j++) {
                if (!strncmp(d->properties[j].name, "timeline.", 9)) {
                    double v; char text[48];
                    if (timeline_value(d->properties[j].value, now-ui->animation_epoch, &v)) {
                        snprintf(text,sizeof(text),"%.6f",v);
                        property(ui,i,d->properties[j].name+9,text);
                    }
                }
                if (!strncmp(d->properties[j].name, "anim.", 5)) {
                    int from, to, duration, delay, repeat, easing;
                    uint64_t elapsed = now - ui->animation_epoch, cycle;
                    double t;
                    char value[32];
                    if (sscanf(d->properties[j].value, "%d,%d,%d,%d,%d,%d", &from, &to, &duration, &delay,
                               &repeat, &easing) != 6 ||
                        duration < 1 || delay < 0 || repeat < 0)
                        continue;
                    if (elapsed < (uint64_t)delay)
                        t = 0;
                    else {
                        elapsed -= (uint64_t)delay;
                        cycle = elapsed / (uint32_t)duration;
                        t = cycle > (uint64_t)repeat ? 1.0
                                                     : (double)(elapsed % (uint32_t)duration) / duration;
                    }
                    if (easing)
                        t = t * t * (3 - 2 * t);
                    snprintf(value, sizeof(value), "%d", (int)lround(from + (to - from) * t));
                    property(ui, i, d->properties[j].name + 5, value);
                }
            }
        }
    }
    lvp_tick(ui->context, now);
    {
        int32_t highest = -1, priority = -1;
        uint32_t i;
        for (i = 0; i < ui->schema->node_count; i++) if (ui->objects[i] && lv_obj_is_visible(ui->objects[i]) &&
            lv_obj_get_screen(ui->objects[i]) == lv_display_get_screen_active(ui->display)) {
            const char *modal = node_property(&ui->schema->nodes[i], "modal");
            const char *value = node_property(&ui->schema->nodes[i], "priority");
            int n = value ? atoi(value) : 0;
            if (modal && !strcmp(modal, "true") && n >= priority) { highest = (int32_t)i; priority = n; }
        }
        if (highest >= 0) lv_obj_move_to_index(ui->objects[highest], -1);
    }
    lv_timer_handler();
    lv_refr_now(ui->display);
}
const uint8_t *lvp_ui_pixels(const lvp_ui *ui) {
    return ui ? ui->pixels : NULL;
}
uint32_t lvp_ui_width(const lvp_ui *ui) {
    return ui ? ui->schema->width : 0;
}
uint32_t lvp_ui_height(const lvp_ui *ui) {
    return ui ? ui->schema->height : 0;
}
void lvp_ui_pointer(lvp_ui *ui, int32_t x, int32_t y, int pressed) {
    if (ui) {
        ui->pointer_x = x;
        ui->pointer_y = y;
        ui->pressed = pressed;
    }
}
lvp_result lvp_ui_navigate(lvp_ui *ui, const char *page) {
    uint32_t i;
    if (!ui || !page)
        return LVP_NOT_FOUND;
    for (i = 0; i < ui->schema->node_count; i++)
        if (ui->schema->nodes[i].parent < 0 && !strcmp(ui->schema->nodes[i].id, page)) {
            int32_t old = ui->active_page;
            if (old == (int32_t)i) return LVP_OK;
            if (!create_page(ui, i)) { release_page(ui, i); return LVP_ERROR; }
            if (old >= 0 && ui->lifecycle) ui->lifecycle(ui, ui->schema->nodes[old].id, LVP_UI_LEAVE, ui->lifecycle_user);
            lv_screen_load(ui->objects[i]);
            ui->active_page = (int32_t)i;
            if (ui->lifecycle) ui->lifecycle(ui, page, LVP_UI_ENTER, ui->lifecycle_user);
            if (old >= 0) {
                const char *retain = node_property(&ui->schema->nodes[old], "retain");
                if (retain && !strcmp(retain, "false")) release_page(ui, (uint32_t)old);
            }
            return LVP_OK;
        }
    return LVP_NOT_FOUND;
}
lvp_result lvp_ui_bounds(lvp_ui *ui, uint32_t node, int32_t *x, int32_t *y, int32_t *w, int32_t *h) {
    lv_area_t a;
    if (!ui || node >= ui->schema->node_count || !x || !y || !w || !h || !ui->objects[node])
        return LVP_RANGE;
    lv_obj_update_layout(ui->objects[node]);
    lv_obj_get_coords(ui->objects[node], &a);
    *x = a.x1;
    *y = a.y1;
    *w = lv_area_get_width(&a);
    *h = lv_area_get_height(&a);
    return LVP_OK;
}

lvp_result lvp_ui_locale(lvp_ui *ui, const char *locale) {
    uint32_t i;
    int found = 0;
    char key[32];
    if (!ui || !locale || strlen(locale) > 16)
        return LVP_TYPE;
    snprintf(key, sizeof(key), "l10n.%s", locale);
    for (i = 0; i < ui->schema->node_count; i++) {
        const char *text = node_property(&ui->schema->nodes[i], key);
        if (text && ui->labels[i]) {
            lv_label_set_text(ui->labels[i], text);
            found = 1;
        }
    }
    return found ? LVP_OK : LVP_NOT_FOUND;
}
void lvp_ui_restart_animations(lvp_ui *ui) {
    if (ui)
        ui->animation_started = 0;
}

/* Internal two-phase reload helpers live here so production rendering need not link the package loader. */
lvp_ui *lvp_ui_candidate(lvp_ui *old, lvp_context *context) {
    return old && !old->owns_display ? lvp_ui_attach(context, old->display) : lvp_ui_create(context);
}
void lvp_ui_commit_candidate(lvp_ui *old, lvp_ui *next) {
    if (old && !old->owns_display) {
        next->previous_screen = old->previous_screen;
        old->previous_screen = NULL;
    }
}

int32_t lvp_ui_hit_test(lvp_ui *ui, int32_t x, int32_t y) {
    uint32_t i;
    lv_area_t bounds;
    if (!ui)
        return -1;
    for (i = ui->schema->node_count; i > 0; i--) {
        lv_obj_t *object = ui->objects[i - 1];
        if (!object || !lv_obj_is_visible(object) ||
            lv_obj_get_screen(object) != lv_display_get_screen_active(ui->display))
            continue;
        lv_obj_get_coords(object, &bounds);
        if (x >= bounds.x1 && x <= bounds.x2 && y >= bounds.y1 && y <= bounds.y2)
            return (int32_t)i - 1;
    }
    return -1;
}

int32_t lvp_ui_action(lvp_ui *ui, const char *action) {
    char key[40];
    uint32_t i;
    if (!ui || !action || strlen(action) > 24)
        return LVP_NOT_FOUND;
    snprintf(key, sizeof(key), "input.%s", action);
    {
        int32_t modal = -1, priority = -1;
        for (i = 0; i < ui->schema->node_count; i++) if (ui->objects[i] && lv_obj_is_visible(ui->objects[i]) &&
            lv_obj_get_screen(ui->objects[i]) == lv_display_get_screen_active(ui->display)) {
            const char *m = node_property(&ui->schema->nodes[i], "modal"), *p = node_property(&ui->schema->nodes[i], "priority");
            int n = p ? atoi(p) : 0;
            if (m && !strcmp(m, "true") && n >= priority) { modal = (int32_t)i; priority = n; }
        }
        if (modal >= 0) {
            const char *command = node_property(&ui->schema->nodes[modal], key);
            return command ? lvp_command(ui->context, command) : LVP_NOT_FOUND;
        }
    }
    for (i = 0; i < ui->schema->node_count; i++)
        if (ui->schema->nodes[i].parent < 0 && ui->objects[i] == lv_display_get_screen_active(ui->display)) {
            const char *command = node_property(&ui->schema->nodes[i], key);
            return command ? lvp_command(ui->context, command) : LVP_NOT_FOUND;
        }
    return LVP_NOT_FOUND;
}

void lvp_ui_set_lifecycle(lvp_ui *ui, lvp_ui_lifecycle_fn fn, void *user) {
    if (ui) { ui->lifecycle = fn; ui->lifecycle_user = user; }
}
lvp_result lvp_ui_push(lvp_ui *ui, const char *page) {
    int32_t old;
    lvp_result result;
    if (!ui) return LVP_TYPE;
    if (ui->navigation_count == 32) return LVP_FULL;
    old = ui->active_page;
    result = lvp_ui_navigate(ui, page);
    if (result == LVP_OK && old >= 0 && old != ui->active_page) ui->navigation[ui->navigation_count++] = (uint32_t)old;
    return result;
}
lvp_result lvp_ui_back(lvp_ui *ui) {
    lvp_result result;
    if (!ui || !ui->navigation_count) return LVP_NOT_FOUND;
    result = lvp_ui_navigate(ui, ui->schema->nodes[ui->navigation[ui->navigation_count - 1]].id);
    if (result == LVP_OK) ui->navigation_count--;
    return result;
}
uint32_t lvp_ui_resident_nodes(const lvp_ui *ui) {
    uint32_t i, total = 0;
    if (ui && ui->objects) for (i = 0; i < ui->schema->node_count; i++) if (ui->objects[i]) total++;
    return total;
}

lvp_result lvp_ui_frame(lvp_ui *ui, const char *node, const void *pixels, size_t length,
                        uint32_t width, uint32_t height, uint32_t stride, lvp_frame_format format) {
    uint32_t i, y, bpp = format == LVP_FRAME_RGB565 ? 2 : 4;
    size_t row, bytes;
    uint8_t *copy;
    sequence_state *state;
    if (!ui || !node || !pixels || width < 1 || height < 1 || width > 4096 || height > 4096 ||
        (format != LVP_FRAME_RGB565 && format != LVP_FRAME_BGRA8888)) return LVP_TYPE;
    row = (size_t)width * bpp; bytes = row * height;
    if (stride < row || (height > 1 && (size_t)stride > (SIZE_MAX - row) / (height - 1)) ||
        (size_t)stride * (height - 1) + row > length) return LVP_RANGE;
    for (i = 0; i < ui->schema->node_count; i++) if (!strcmp(ui->schema->nodes[i].id, node)) break;
    if (i == ui->schema->node_count || !ui->objects[i]) return LVP_NOT_FOUND;
    if (ui->schema->nodes[i].kind != 7) return LVP_TYPE;
    copy = malloc(bytes);
    if (!copy) return LVP_FULL;
    for (y = 0; y < height; y++) memcpy(copy + row*y, (const uint8_t *)pixels + (size_t)stride*y, row);
    state = &ui->sequences[i];
    lv_image_cache_drop(&state->image);
    free(state->pixels); state->pixels = copy;
    memset(&state->image, 0, sizeof(state->image));
    state->image.header.magic = LV_IMAGE_HEADER_MAGIC;
    state->image.header.cf = format == LVP_FRAME_RGB565 ? LV_COLOR_FORMAT_RGB565 : LV_COLOR_FORMAT_ARGB8888;
    state->image.header.w = width; state->image.header.h = height; state->image.header.stride = (uint32_t)row;
    state->image.data_size = (uint32_t)bytes; state->image.data = copy;
    lv_image_set_src(ui->objects[i], &state->image);
    return LVP_OK;
}
