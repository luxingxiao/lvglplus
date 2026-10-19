/* SPDX-License-Identifier: Apache-2.0 */
#ifndef LVGLPLUS_UI_H
#define LVGLPLUS_UI_H
#include "lvglplus.h"
#ifdef __cplusplus
extern "C" {
#endif
typedef struct lvp_ui lvp_ui;
const char *lvp_ui_error(void);
typedef enum { LVP_UI_CREATE, LVP_UI_ENTER, LVP_UI_LEAVE, LVP_UI_DESTROY } lvp_ui_lifecycle_event;
/* Observers run synchronously; do not navigate, destroy or reload the UI in this callback. */
typedef void (*lvp_ui_lifecycle_fn)(lvp_ui *, const char *, lvp_ui_lifecycle_event, void *);
void lvp_ui_set_lifecycle(lvp_ui *ui, lvp_ui_lifecycle_fn callback, void *user);
lvp_result lvp_ui_push(lvp_ui *ui, const char *page);
lvp_result lvp_ui_back(lvp_ui *ui);
uint32_t lvp_ui_resident_nodes(const lvp_ui *ui);
typedef enum { LVP_FRAME_RGB565, LVP_FRAME_BGRA8888 } lvp_frame_format;
/* Copies a complete frame on the UI thread; caller may release input after return.
   A lazy/unloaded node returns NOT_FOUND. Previous frame survives allocation/validation failure. */
lvp_result lvp_ui_frame(lvp_ui *ui, const char *node, const void *pixels, size_t length,
                        uint32_t width, uint32_t height, uint32_t stride, lvp_frame_format format);
typedef struct {
    lvp_result (*open)(lvp_context *, lvp_ui *, void **state);
    void (*tick)(lvp_context *, lvp_ui *, uint64_t now_ms, void *state);
    void (*close)(lvp_context *, lvp_ui *, void *state);
} lvp_application;
/* Register before UI creation. The descriptor must outlive all views; each UI owns its state. */
lvp_result lvp_register_application(const lvp_application *application);
#define LVP_WIDGET_ABI 1
/* Registry entries and names must outlive every UI. Register before creating any view.
   Return an lv_obj_t from create; LVGL delete events own widget-specific cleanup. */
typedef struct {
    uint32_t abi;
    const char *name;
    void *(*create)(void *parent);
    void (*property)(void *object, const char *name, const char *value);
} lvp_widget_factory;
lvp_result lvp_ui_register_widget(const lvp_widget_factory *factory);
lvp_result lvp_ui_register_font(const char *name, const void *lv_font);
lvp_result lvp_ui_locale(lvp_ui *ui, const char *locale);
/* Restart deterministic animations using the next UI tick as time zero. */
void lvp_ui_restart_animations(lvp_ui *ui);
/* LVGL must be initialized before create. Context and schema must outlive UI. */
lvp_ui *lvp_ui_create(lvp_context *context);
void lvp_ui_destroy(lvp_ui *ui);
void lvp_ui_tick(lvp_ui *ui, uint64_t now_ms);
const uint8_t *lvp_ui_pixels(const lvp_ui *ui); /* BGRA8888 framebuffer */
uint32_t lvp_ui_width(const lvp_ui *ui);
uint32_t lvp_ui_height(const lvp_ui *ui);
/* Semantic input: platform keys, handlebar adapters and browser share this entry. */
int32_t lvp_ui_action(lvp_ui *ui, const char *action);
void lvp_ui_pointer(lvp_ui *ui, int32_t x, int32_t y, int pressed);
lvp_result lvp_ui_navigate(lvp_ui *ui, const char *page);
int32_t lvp_ui_hit_test(lvp_ui *ui, int32_t x, int32_t y);
lvp_result lvp_ui_bounds(lvp_ui *ui, uint32_t node, int32_t *x, int32_t *y, int32_t *width, int32_t *height);
/* Transactional bundle reload: mount verified resources first. On failure, all old pointers
   remain valid. On success old context subscriptions/adapters are destroyed; reattach app handlers. */
lvp_result lvp_ui_replace(lvp_ui **ui, lvp_context **context, lvp_package **package, const uint8_t *bundle,
                          size_t length, char *error, size_t error_size);
/* Canvas-free firmware path: attach to an application's initialized lv_display. */
lvp_ui *lvp_ui_attach(lvp_context *context, void *lv_display);
#ifdef __cplusplus
}
#endif
#endif
