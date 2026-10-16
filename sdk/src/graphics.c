/* SPDX-License-Identifier: Apache-2.0 */
#include "graphics.h"
#include "src/misc/cache/instance/lv_image_cache.h"
#include <math.h>
#include <stdlib.h>
#include <string.h>
#define PI 3.14159265358979323846
typedef struct {
    unsigned kind, count;
    double x[64], y[64], start, end;
    lv_color_t color, fill;
    int width, dash, gap, grid_x, grid_y, smooth, fade;
    int tail_opacity, head_opacity, radial_opacity, fade_power, inner_radius, raster_size;
    int dirty;
    uint8_t *alpha;
    lv_image_dsc_t image;
} graphic;
static lv_point_precise_t point(double x, double y) {
    lv_point_precise_t p = {(int32_t)lround(x), (int32_t)lround(y)};
    return p;
}
static void segment(lv_layer_t *layer, lv_draw_line_dsc_t *d, double ax, double ay, double bx, double by) {
    d->p1 = point(ax, ay);
    d->p2 = point(bx, by);
    if (d->p1.x != d->p2.x || d->p1.y != d->p2.y)
        lv_draw_line(layer, d);
}
/* A8 coverage is cached in object space: rotations/recolors do not rasterize again.
 * At most raster_size^2 bytes (default/max 512^2) per sector. */
static double coverage(const graphic *g, double x, double y) {
    double r = hypot(x, y), inner = g->inner_radius / 100.0;
    double span = fmax(-360, fmin(360, g->end - g->start));
    if (r > 1 || r < inner || fabs(span) < 0.000001)
        return 0;
    double angle = atan2(y, x) * 180 / PI;
    double delta = fmod((span < 0 ? g->start - angle : angle - g->start), 360);
    if (delta < 0)
        delta += 360;
    if (delta > fabs(span))
        return 0;
    double t = delta / fabs(span), ramp = 1;
    if (g->fade) {
        ramp = t;
        for (int i = 1; i < g->fade_power; i++)
            ramp *= t;
    }
    double alpha = g->fade ? g->tail_opacity + (g->head_opacity - g->tail_opacity) * ramp
                           : g->head_opacity;
    double radial = (r - inner) / (1 - inner);
    return alpha * (1 - radial * (1 - g->radial_opacity / 255.0));
}
static int sector_cache(graphic *g, int width, int height) {
    if (width <= 0 || height <= 0)
        return 0;
    int w = width < g->raster_size ? width : g->raster_size;
    int h = height < g->raster_size ? height : g->raster_size;
    if (!g->dirty && g->image.header.w == (unsigned)w && g->image.header.h == (unsigned)h)
        return 1;
    uint8_t *pixels = malloc((size_t)w * h);
    if (!pixels) {
        LV_LOG_WARN("Plus sector coverage allocation failed");
        return 0;
    }
    /* Four subpixel samples anti-alias both circular and angular boundaries. */
    for (int y = 0; y < h; y++)
        for (int x = 0; x < w; x++) {
            double alpha = 0;
            for (int sy = 0; sy < 2; sy++)
                for (int sx = 0; sx < 2; sx++)
                    alpha += coverage(g, 2 * (x + .25 + .5 * sx) / w - 1,
                                         2 * (y + .25 + .5 * sy) / h - 1);
            /* libm atan2 can straddle an exact half-alpha at diagonal pixels.
             * Snap to 1e-7 alpha units before half-up quantization for C/WASM parity. */
            double averaged = floor((alpha / 4) * 1e7 + .5) / 1e7;
            pixels[y * w + x] = (uint8_t)floor(averaged + .5);
        }
    lv_image_cache_drop(&g->image);
    free(g->alpha);
    g->alpha = pixels;
    memset(&g->image, 0, sizeof(g->image));
    g->image.header.magic = LV_IMAGE_HEADER_MAGIC;
    g->image.header.cf = LV_COLOR_FORMAT_A8;
    g->image.header.w = w;
    g->image.header.h = h;
    g->image.header.stride = w;
    g->image.data_size = (uint32_t)w * h;
    g->image.data = pixels;
    g->dirty = 0;
    return 1;
}
static void render(lv_event_t *event) {
    graphic *g = lv_event_get_user_data(event);
    if (lv_event_get_code(event) == LV_EVENT_DELETE) {
        lv_image_cache_drop(&g->image);
        free(g->alpha);
        free(g);
        return;
    }
    lv_obj_t *obj = lv_event_get_target_obj(event);
    lv_area_t a;
    lv_obj_get_coords(obj, &a);
    lv_layer_t *layer = lv_event_get_layer(event);
    double x = a.x1, y = a.y1, w = lv_obj_get_width(obj), h = lv_obj_get_height(obj);
    lv_draw_line_dsc_t line;
    lv_draw_line_dsc_init(&line);
    line.color = g->color;
    line.width = g->width;
    line.dash_width = g->dash;
    line.dash_gap = g->gap;
    line.round_start = line.round_end = 1;
    if (g->kind == 12) {
        for (int j = 0; j <= w && j < 4096; j += g->grid_x)
            segment(layer, &line, x + j, y, x + j, y + h - 1);
        for (int j = 0; j <= h && j < 4096; j += g->grid_y)
            segment(layer, &line, x, y + j, x + w - 1, y + j);
    } else if (g->kind == 11) {
        if (sector_cache(g, (int)w, (int)h)) {
            lv_draw_image_dsc_t d;
            lv_draw_image_dsc_init(&d);
            d.src = &g->image;
            d.recolor = g->fill;
            d.recolor_opa = LV_OPA_COVER;
            d.scale_x = (int32_t)lround(w * 256 / g->image.header.w);
            d.scale_y = (int32_t)lround(h * 256 / g->image.header.h);
            d.antialias = 1;
            lv_area_t image_area = {a.x1, a.y1, a.x1 + g->image.header.w - 1,
                                    a.y1 + g->image.header.h - 1};
            lv_draw_image(layer, &d, &image_area);
        }
    } else {
        if (g->kind == 10 && g->count >= 3) {
            /* Bounded ear clipping supports simple concave polygons without a project renderer. */
            unsigned vertices[64], count = g->count;
            double area = 0;
            for (unsigned i = 0; i < count; i++) {
                vertices[i] = i;
                unsigned j = (i + 1) % count;
                area += g->x[i] * g->y[j] - g->x[j] * g->y[i];
            }
            double sign = area >= 0 ? 1 : -1;
            lv_draw_triangle_dsc_t d;
            lv_draw_triangle_dsc_init(&d);
            d.color = g->fill;
            for (unsigned pass = 0; count > 2 && pass < 64; pass++) {
                int clipped = 0;
                for (unsigned i = 0; i < count; i++) {
                    unsigned a0 = vertices[(i + count - 1) % count], b = vertices[i],
                             c = vertices[(i + 1) % count];
                    double cross = (g->x[b] - g->x[a0]) * (g->y[c] - g->y[a0]) -
                                   (g->y[b] - g->y[a0]) * (g->x[c] - g->x[a0]);
                    if (cross * sign <= 0.000001)
                        continue;
                    int inside = 0;
                    for (unsigned j = 0; j < count; j++) {
                        unsigned p = vertices[j];
                        if (p == a0 || p == b || p == c)
                            continue;
                        double ab = (g->x[b] - g->x[a0]) * (g->y[p] - g->y[a0]) -
                                    (g->y[b] - g->y[a0]) * (g->x[p] - g->x[a0]);
                        double bc = (g->x[c] - g->x[b]) * (g->y[p] - g->y[b]) -
                                    (g->y[c] - g->y[b]) * (g->x[p] - g->x[b]);
                        double ca = (g->x[a0] - g->x[c]) * (g->y[p] - g->y[c]) -
                                    (g->y[a0] - g->y[c]) * (g->x[p] - g->x[c]);
                        if (ab * sign >= 0 && bc * sign >= 0 && ca * sign >= 0) {
                            inside = 1;
                            break;
                        }
                    }
                    if (inside)
                        continue;
                    d.p[0] = point(x + g->x[a0], y + g->y[a0]);
                    d.p[1] = point(x + g->x[b], y + g->y[b]);
                    d.p[2] = point(x + g->x[c], y + g->y[c]);
                    lv_draw_triangle(layer, &d);
                    for (unsigned j = i; j + 1 < count; j++)
                        vertices[j] = vertices[j + 1];
                    count--;
                    clipped = 1;
                    break;
                }
                if (!clipped)
                    break; /* Degenerate/self-intersecting input has no defined fill. */
            }
        }
        unsigned length = g->count + (g->kind == 10 && g->count ? 1 : 0);
        for (unsigned i = 1; i < length; i++) {
            unsigned a0 = i - 1, b = i % g->count;
            if (g->smooth && g->kind == 9) {
                unsigned p0 = a0 ? a0 - 1 : a0, p3 = b + 1 < g->count ? b + 1 : b;
                double ax = g->x[a0], ay = g->y[a0];
                for (int k = 1; k <= 12; k++) {
                    double t = k / 12.0, t2 = t * t, t3 = t2 * t;
                    double bx = .5 * ((2 * g->x[a0]) + (-g->x[p0] + g->x[b]) * t +
                                      (2 * g->x[p0] - 5 * g->x[a0] + 4 * g->x[b] - g->x[p3]) * t2 +
                                      (-g->x[p0] + 3 * g->x[a0] - 3 * g->x[b] + g->x[p3]) * t3);
                    double by = .5 * ((2 * g->y[a0]) + (-g->y[p0] + g->y[b]) * t +
                                      (2 * g->y[p0] - 5 * g->y[a0] + 4 * g->y[b] - g->y[p3]) * t2 +
                                      (-g->y[p0] + 3 * g->y[a0] - 3 * g->y[b] + g->y[p3]) * t3);
                    segment(layer, &line, x + ax, y + ay, x + bx, y + by);
                    ax = bx;
                    ay = by;
                }
            } else
                segment(layer, &line, x + g->x[a0], y + g->y[a0], x + g->x[b], y + g->y[b]);
        }
    }
}
lv_obj_t *lvp_graphic_create(lv_obj_t *parent, unsigned kind) {
    graphic *g = calloc(1, sizeof(*g));
    if (!g)
        return NULL;
    lv_obj_t *obj = lv_obj_create(parent);
    if (!obj) {
        free(g);
        return NULL;
    }
    g->kind = kind;
    g->color = g->fill = lv_color_hex(0x6ee7b7);
    g->width = 2;
    g->grid_x = g->grid_y = 20;
    g->end = 45;
    g->head_opacity = g->radial_opacity = 255;
    g->fade_power = 1;
    g->raster_size = 512;
    g->dirty = 1;
    lv_obj_remove_style_all(obj);
    lv_obj_remove_flag(obj, LV_OBJ_FLAG_SCROLLABLE | LV_OBJ_FLAG_CLICKABLE);
    lv_obj_set_user_data(obj, g);
    lv_obj_add_event_cb(obj, render, LV_EVENT_DRAW_MAIN, g);
    lv_obj_add_event_cb(obj, render, LV_EVENT_DELETE, g);
    return obj;
}
int lvp_graphic_property(lv_obj_t *obj, const char *key, const char *value) {
    graphic *g = lv_obj_get_user_data(obj);
    if (!g)
        return 0;
    double n = strtod(value, NULL);
    if (!isfinite(n))
        return 0;
    if (!strcmp(key, "color"))
        g->color = lv_color_hex((uint32_t)strtoul(value[0] == '#' ? value + 1 : value, NULL, 16));
    else if (!strcmp(key, "bg"))
        g->fill = lv_color_hex((uint32_t)strtoul(value[0] == '#' ? value + 1 : value, NULL, 16));
    else if (!strcmp(key, "lineWidth"))
        g->width = (int)fmax(0, fmin(64, n));
    else if (!strcmp(key, "dashLength"))
        g->dash = (int)fmax(0, fmin(4096, n));
    else if (!strcmp(key, "dashGap"))
        g->gap = (int)fmax(0, fmin(4096, n));
    else if (!strcmp(key, "gridX"))
        g->grid_x = (int)fmax(2, fmin(4096, n));
    else if (!strcmp(key, "gridY"))
        g->grid_y = (int)fmax(2, fmin(4096, n));
    else if (!strcmp(key, "startAngle"))
        g->start = fmax(-32767, fmin(32767, n));
    else if (!strcmp(key, "endAngle"))
        g->end = fmax(-32767, fmin(32767, n));
    else if (!strcmp(key, "curve"))
        g->smooth = !strcmp(value, "catmull-rom");
    else if (!strcmp(key, "fade"))
        g->fade = !strcmp(value, "true");
    else if (!strcmp(key, "tailOpacity"))
        g->tail_opacity = (int)fmax(0, fmin(255, n));
    else if (!strcmp(key, "headOpacity"))
        g->head_opacity = (int)fmax(0, fmin(255, n));
    else if (!strcmp(key, "radialOpacity"))
        g->radial_opacity = (int)fmax(0, fmin(255, n));
    else if (!strcmp(key, "fadePower"))
        g->fade_power = (int)fmax(1, fmin(8, n));
    else if (!strcmp(key, "innerRadius"))
        g->inner_radius = (int)fmax(0, fmin(99, n));
    else if (!strcmp(key, "rasterSize"))
        g->raster_size = (int)fmax(32, fmin(512, n));
    else if (!strcmp(key, "points")) {
        const char *p = value;
        g->count = 0;
        while (*p && g->count < 64) {
            char *end;
            double x = strtod(p, &end);
            if (end == p || *end != ',' || !isfinite(x) || fabs(x) > 32767)
                break;
            p = end + 1;
            double y = strtod(p, &end);
            if (end == p || !isfinite(y) || fabs(y) > 32767)
                break;
            g->x[g->count] = x;
            g->y[g->count++] = y;
            p = end;
            while (*p == ' ')
                p++;
        }
    } else
        return 0;
    if (strcmp(key, "bg") && strcmp(key, "color"))
        g->dirty = 1;
    lv_obj_invalidate(obj);
    return 1;
}
void lvp_graphic_point(lv_obj_t *obj, unsigned index, int y, double value) {
    graphic *g = lv_obj_get_user_data(obj);
    if (!g || index >= g->count || !isfinite(value) || fabs(value) > 32767)
        return;
    if (y)
        g->y[index] = value;
    else
        g->x[index] = value;
    lv_obj_invalidate(obj);
}
