/* SPDX-License-Identifier: Apache-2.0 */
#ifndef LVP_GRAPHICS_H
#define LVP_GRAPHICS_H
#include "lvgl.h"
lv_obj_t *lvp_graphic_create(lv_obj_t *parent, unsigned kind);
int lvp_graphic_property(lv_obj_t *object, const char *name, const char *value);
void lvp_graphic_point(lv_obj_t *object, unsigned point, int y, double value);
#endif
