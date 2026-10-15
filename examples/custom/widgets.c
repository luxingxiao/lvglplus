/* SPDX-License-Identifier: Apache-2.0 */
#include "lvgl.h"
#include "lvglplus_ui.h"
#include <stdlib.h>
#include <string.h>
static void *create_meter(void *parent) {
    return lv_bar_create(parent);
}
static void meter_property(void *object, const char *name, const char *value) {
    if (!strcmp(name, "value"))
        lv_bar_set_value(object, atoi(value), LV_ANIM_OFF);
}
void lvp_register_custom_widgets(void) {
    static const lvp_widget_factory factory = {LVP_WIDGET_ABI, "meter", create_meter, meter_property};
    lvp_ui_register_widget(&factory);
    lvp_ui_register_font("cluster", &lv_font_montserrat_28);
}
