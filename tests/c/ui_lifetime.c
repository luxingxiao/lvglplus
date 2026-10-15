/* SPDX-License-Identifier: Apache-2.0 */
#include "lvgl.h"
#include "lvglplus_ui.h"
#include <assert.h>
#include <stdio.h>
static const lvp_node_def nodes[] = {{"home", 0, -1, "", NULL, 0, NULL, 0}};
static const lvp_schema schema = {1, 64, 64, "home", NULL, 0, NULL, NULL, 0, nodes, 1};
int main(void) {
    lvp_context *ctx;
    lvp_ui *owner, *attached;
    lv_display_t *display;
    lv_obj_t *original;
    lv_init();
    ctx = lvp_create(&schema, NULL);
    assert(ctx);
    owner = lvp_ui_create(ctx);
    assert(owner);
    display = lv_display_get_default();
    original = lv_display_get_screen_active(display);
    attached = lvp_ui_attach(ctx, display);
    assert(attached);
    assert(lv_display_get_screen_active(display) != original);
    lvp_ui_tick(attached, 10);
    lvp_ui_destroy(attached);
    assert(lv_display_get_screen_active(display) == original);
    lvp_ui_tick(owner, 20);
    lvp_ui_destroy(owner);
    lvp_destroy(ctx);
    lv_deinit();
    puts("UI attach/detach restores the host screen without dangling bindings");
    return 0;
}
