/* SPDX-License-Identifier: Apache-2.0 */
#ifndef LVGLPLUS_UI_H
#define LVGLPLUS_UI_H
#include "lvglplus.h"
#ifdef __cplusplus
extern "C" {
#endif
typedef struct lvp_ui lvp_ui;
/* LVGL must be initialized before create. Context and schema must outlive UI. */
lvp_ui *lvp_ui_create(lvp_context *context);
void lvp_ui_destroy(lvp_ui *ui);
void lvp_ui_tick(lvp_ui *ui, uint64_t now_ms);
const uint8_t *lvp_ui_pixels(const lvp_ui *ui); /* BGRA8888 framebuffer */
uint32_t lvp_ui_width(const lvp_ui *ui);
uint32_t lvp_ui_height(const lvp_ui *ui);
void lvp_ui_pointer(lvp_ui *ui, int32_t x, int32_t y, int pressed);
lvp_result lvp_ui_navigate(lvp_ui *ui, const char *page);
lvp_result lvp_ui_bounds(lvp_ui *ui, uint32_t node, int32_t *x, int32_t *y, int32_t *width, int32_t *height);
/* Canvas-free firmware path: attach to an application's initialized lv_display. */
lvp_ui *lvp_ui_attach(lvp_context *context, void *lv_display);
#ifdef __cplusplus
}
#endif
#endif
