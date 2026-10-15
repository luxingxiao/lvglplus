/* SPDX-License-Identifier: Apache-2.0 */
#include "lvgl.h"
#include "lvglplus_ui.h"
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
typedef struct binding_state binding_state;
struct lvp_ui {
    lvp_context *context;
    const lvp_schema *schema;
    lv_display_t *display;
    lv_indev_t *input;
    lv_obj_t **objects, **labels;
    lv_obj_t *previous_screen;
    uint8_t *pixels, *draw_buffer;
    int owns_display, applying;
    int32_t pointer_x, pointer_y;
    int pressed;
    uint64_t now;
    binding_state *bindings;
};
struct binding_state {
    lvp_ui *ui;
    uint32_t node;
    const lvp_binding_def *definition;
    lvp_subscription *subscription;
    binding_state *next;
};
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
static void apply_binding(lvp_context *ctx, uint32_t signal, const lvp_value *value, void *user) {
    binding_state *b = user;
    lvp_ui *ui = b->ui;
    const lvp_binding_def *d = b->definition;
    lv_obj_t *obj = ui->objects[b->node];
    char text[384];
    ui->applying++;
    switch (d->property) {
    case LVP_BIND_TEXT:
        if (value->quality != LVP_VALID)
            strcpy(text, "--");
        else
            format_value(text, sizeof(text), d->format, value,
                         ui->schema->signals[signal].type == LVP_STRING);
        if (ui->labels[b->node])
            lv_label_set_text(ui->labels[b->node], text);
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
        if (value->number >= 0 && value->number <= 0xffffff)
            lv_obj_set_style_text_color(obj, lv_color_hex((uint32_t)value->number), 0);
        break;
    case LVP_BIND_QUALITY: {
        static const char *q[] = {"LIVE", "STALE", "INVALID", "OFFLINE"};
        if (ui->labels[b->node])
            lv_label_set_text(ui->labels[b->node], q[value->quality]);
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
    if (node->command && node->command[0])
        lvp_command(b->ui->context, node->command);
    for (i = 0; i < node->property_count; i++)
        if (!strcmp(node->properties[i].name, "navigate"))
            lvp_ui_navigate(b->ui, node->properties[i].value);
}
static void property(lvp_ui *ui, uint32_t index, const char *name, const char *value) {
    lv_obj_t *obj = ui->objects[index];
    uint32_t kind = ui->schema->nodes[index].kind;
    int32_t n = atoi(value);
    if (!strcmp(name, "x"))
        lv_obj_set_x(obj, n);
    else if (!strcmp(name, "y"))
        lv_obj_set_y(obj, n);
    else if (!strcmp(name, "width"))
        lv_obj_set_width(obj, size_value(value));
    else if (!strcmp(name, "height"))
        lv_obj_set_height(obj, size_value(value));
    else if (!strcmp(name, "bg")) {
        lv_obj_set_style_bg_color(obj, lv_color_hex(color(value)), 0);
        lv_obj_set_style_bg_opa(obj, LV_OPA_COVER, 0);
    } else if (!strcmp(name, "color")) {
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
    else if (!strcmp(name, "textAlign"))
        lv_obj_set_style_text_align(obj,
                                    !strcmp(value, "center")  ? LV_TEXT_ALIGN_CENTER
                                    : !strcmp(value, "right") ? LV_TEXT_ALIGN_RIGHT
                                                              : LV_TEXT_ALIGN_LEFT,
                                    0);
    else if (!strcmp(name, "text") && ui->labels[index])
        lv_label_set_text(ui->labels[index], value);
    else if (!strcmp(name, "hidden") && !strcmp(value, "true"))
        lv_obj_add_flag(obj, LV_OBJ_FLAG_HIDDEN);
    else if (!strcmp(name, "border"))
        lv_obj_set_style_border_width(obj, n, 0);
    else if (!strcmp(name, "borderColor"))
        lv_obj_set_style_border_color(obj, lv_color_hex(color(value)), 0);
    else if (!strcmp(name, "opacity"))
        lv_obj_set_style_opa(obj, (lv_opa_t)n, 0);
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
}
static int make_objects(lvp_ui *ui) {
    uint32_t i, j;
    ui->objects = calloc(ui->schema->node_count, sizeof(lv_obj_t *));
    ui->labels = calloc(ui->schema->node_count, sizeof(lv_obj_t *));
    if (!ui->objects || !ui->labels)
        return 0;
    for (i = 0; i < ui->schema->node_count; i++) {
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
            default:
                return 0;
            }
        if (!obj)
            return 0;
        ui->objects[i] = obj;
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
        for (j = 0; j < d->property_count; j++)
            property(ui, i, d->properties[j].name, d->properties[j].value);
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
        if (d->kind == 2) {
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
    return ui;
}
void lvp_ui_destroy(lvp_ui *ui) {
    uint32_t i;
    binding_state *b;
    if (!ui)
        return;
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
    free(ui->objects);
    free(ui->labels);
    free(ui->pixels);
    free(ui->draw_buffer);
    free(ui);
}
void lvp_ui_tick(lvp_ui *ui, uint64_t now) {
    if (!ui)
        return;
    ui->now = now;
    if (ui->owns_display) {
        clock_ms = (uint32_t)now;
        lv_tick_set_cb(tick_clock);
    }
    lvp_tick(ui->context, now);
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
            lv_screen_load(ui->objects[i]);
            return LVP_OK;
        }
    return LVP_NOT_FOUND;
}
lvp_result lvp_ui_bounds(lvp_ui *ui, uint32_t node, int32_t *x, int32_t *y, int32_t *w, int32_t *h) {
    lv_area_t a;
    if (!ui || node >= ui->schema->node_count || !x || !y || !w || !h)
        return LVP_RANGE;
    lv_obj_update_layout(ui->objects[node]);
    lv_obj_get_coords(ui->objects[node], &a);
    *x = a.x1;
    *y = a.y1;
    *w = lv_area_get_width(&a);
    *h = lv_area_get_height(&a);
    return LVP_OK;
}
