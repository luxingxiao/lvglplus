/* SPDX-License-Identifier: Apache-2.0 */
#define _POSIX_C_SOURCE 200809L
#include "lvgl.h"
#include "lvglplus_ui.h"
#include "ui_gen.h"
#ifdef LVP_WITH_DBC
#include "lvglplus_linux.h"
extern int lvp_dbc_decode(const lvp_can_frame *, lvp_emit_fn, void *);
#endif
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <time.h>
#ifndef LVP_SCHEMA
#define LVP_SCHEMA vehicle_schema
#endif
static volatile sig_atomic_t running = 1;
static uint64_t monotonic_ms(void) {
    struct timespec t;
    clock_gettime(CLOCK_MONOTONIC, &t);
    return (uint64_t)t.tv_sec * 1000 + (uint64_t)t.tv_nsec / 1000000;
}
static uint32_t clock_ms(void) {
    return (uint32_t)monotonic_ms();
}
static void stop(int signal) {
    (void)signal;
    running = 0;
}
int main(int argc, char **argv) {
    lv_display_t *display;
    lvp_context *model;
    lvp_ui *view;
    struct timespec pause = {0, 5000000};
    lv_init();
    lv_tick_set_cb(clock_ms);
    display = lv_linux_drm_create();
    if (!display)
        return 1;
    if (lv_linux_drm_set_file(display, argc > 1 ? argv[1] : "/dev/dri/card0", -1) != LV_RESULT_OK) {
        fprintf(stderr, "Cannot open DRM device\n");
        return 2;
    }
    if (argc > 2) {
        lv_indev_t *input = lv_evdev_create(LV_INDEV_TYPE_POINTER, argv[2]);
        if (!input)
            return 3;
        lv_indev_set_display(input, display);
    }
#ifdef LVP_CUSTOM
    {
        extern void lvp_register_custom_widgets(void);
        lvp_register_custom_widgets();
    }
#endif
    model = lvp_create(&LVP_SCHEMA, NULL);
    view = lvp_ui_attach(model, display);
    if (!view) {
        fprintf(stderr, "Display resolution must match generated target\n");
        return 4;
    }
#ifdef LVP_WITH_DBC
    lvp_linux_can can;
    if (argc > 3) {
        int32_t id = lvp_linux_can_register(model, &can, argv[3], lvp_dbc_decode);
        if (id >= 0) {
            int32_t alarm = lvp_find(model, "vehicle.alarm");
            if (alarm >= 0)
                can.events[alarm] = 1;
        }
        if (id < 0 || lvp_adapter_start(model, (uint32_t)id) != LVP_OK)
            return 5;
    }
#endif
    signal(SIGINT, stop);
    signal(SIGTERM, stop);
    while (running) {
        lvp_ui_tick(view, monotonic_ms());
        nanosleep(&pause, NULL);
    }
    lvp_ui_destroy(view);
    lvp_destroy(model);
    lv_display_delete(display);
    lv_deinit();
    return 0;
}
