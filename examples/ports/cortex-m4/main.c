/* SPDX-License-Identifier: Apache-2.0 */
/* BSP integration entrypoint, compiled by CI; intentionally no invented board support. */
#include "lvgl.h"
#include "lvglplus_ui.h"
#include "ui_gen.h"
#ifndef LVP_SCHEMA
#define LVP_SCHEMA vehicle_schema
#endif
extern void *board_display_init(void);
extern uint64_t board_time_ms(void);
extern void board_wait_ms(uint32_t delay);
extern void board_ingress_lock(void *user);
extern void board_ingress_unlock(void *user);
int lvglplus_app(void) {
    lvp_hal hal = {0};
    lvp_context *model;
    lvp_ui *view;
    void *display;
    lv_init();
    display = board_display_init();
    if (!display)
        return -1;
    hal.lock = board_ingress_lock;
    hal.unlock = board_ingress_unlock;
    hal.queue_capacity = 64;
    model = lvp_create(&LVP_SCHEMA, &hal);
    if (!model)
        return -2;
    view = lvp_ui_attach(model, display);
    if (!view) {
        lvp_destroy(model);
        return -3;
    }
    /* Register transport adapters here; ISR/workers publish via lvp_adapter_publish.
       BSP must supply a compatible allocator and LVGL tick source. */
    for (;;) {
        lvp_ui_tick(view, board_time_ms());
        board_wait_ms(5);
    }
}
