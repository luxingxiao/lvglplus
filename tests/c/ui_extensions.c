/* SPDX-License-Identifier: Apache-2.0 */
#include "lvgl.h"
#include "lvglplus_ui.h"
#include <assert.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
static lv_obj_t *custom;
static void *create(void *parent) {
    custom = lv_label_create(parent);
    return custom;
}
static void set(void *obj, const char *key, const char *value) {
    if (!strcmp(key, "value"))
        lv_label_set_text(obj, value);
}
static const lvp_widget_factory factory = {1, "test", create, set};
static const lvp_property page_props[] = {{"bg", "#001122"}};
static const lvp_property label_props[] = {{"textKey", "title"},           {"l10n.en", "Hello"},
                                           {"l10n.de", "Hallo"},           {"locale", "en"},
                                           {"anim.x", "0,100,1000,0,0,0"}, {"font", "testFont"}};
static const lvp_property custom_props[] = {{"customType", "test"}};
static const lvp_binding_def binding = {LVP_BIND_VALUE, 0, 0, ""};
static const lvp_node_def nodes[] = {{"home", 0, -1, "", page_props, 1, NULL, 0},
                                     {"label", 1, 0, "", label_props, 6, NULL, 0},
                                     {"custom", 8, 0, "", custom_props, 1, &binding, 1}};
static const lvp_signal_def speed_signal = {"vehicle.speed", LVP_NUMBER, 12, "", 0, 0, NULL, 0, "km/h", NULL};
static const uint32_t order[] = {0};
static const lvp_schema schema = {1, 800, 480, "home", &speed_signal, 1, order, NULL, 0, nodes, 3};
int main(int argc, char **argv) {
    lvp_context *ctx;
    lvp_ui *ui;
    int32_t x, y, w, h;
    lv_init();
    assert(lvp_ui_register_widget(&factory) == LVP_OK);
    assert(lvp_ui_register_widget(&factory) != LVP_OK);
    assert(lvp_ui_register_font("testFont", &lv_font_montserrat_20) == LVP_OK);
    ctx = lvp_create(&schema, NULL);
    ui = lvp_ui_create(ctx);
    assert(ui);
    lvp_ui_tick(ui, 0);
    assert(!strcmp(lv_label_get_text(custom), "12"));
    assert(lvp_ui_locale(ui, "de") == LVP_OK);
    assert(lvp_ui_locale(ui, "missing") == LVP_NOT_FOUND);
    lvp_ui_tick(ui, 500);
    assert(lvp_ui_bounds(ui, 1, &x, &y, &w, &h) == LVP_OK);
    assert(x == 50);
    lvp_ui_tick(ui, 1000);
    lvp_ui_bounds(ui, 1, &x, &y, &w, &h);
    assert(x == 100);
    lvp_ui_restart_animations(ui);
    lvp_ui_tick(ui, 1001);
    lvp_ui_bounds(ui, 1, &x, &y, &w, &h);
    assert(x == 0);
    if (argc > 1) {
        lvp_context *host_context = ctx;
        lvp_ui *host = ui;
        lv_display_t *display = lv_display_get_default();
        lv_obj_t *host_screen = lv_display_get_screen_active(display);
        ctx = lvp_create(&schema, NULL);
        ui = lvp_ui_attach(ctx, display);
        assert(ui);
        FILE *file = fopen(argv[1], "rb");
        long size;
        unsigned char *bytes;
        lvp_package *package = NULL;
        char error[256];
        lvp_ui *original = ui;
        assert(file);
        fseek(file, 0, SEEK_END);
        size = ftell(file);
        rewind(file);
        bytes = malloc((size_t)size);
        assert(bytes);
        assert(fread(bytes, 1, (size_t)size, file) == (size_t)size);
        fclose(file);
        bytes[31] ^= 0;
        bytes[40] ^= 1;
        assert(lvp_ui_replace(&ui, &ctx, &package, bytes, (size_t)size, error, sizeof(error)) != LVP_OK);
        assert(ui == original);
        lvp_ui_tick(ui, 1002);
        bytes[40] ^= 1;
        lvp_set_number(ctx, 0, 29, 1002, LVP_VALID);
        assert(lvp_ui_replace(&ui, &ctx, &package, bytes, (size_t)size, error, sizeof(error)) == LVP_OK);
        assert(lvp_get(ctx, (uint32_t)lvp_find(ctx, "vehicle.speed"))->number == 29);
        lvp_ui_tick(ui, 1003);
        free(bytes);
        lvp_ui_destroy(ui);
        assert(lv_display_get_screen_active(display) == host_screen);
        lvp_destroy(ctx);
        lvp_package_free(package);
        lvp_ui_destroy(host);
        lvp_destroy(host_context);
    } else {
        lvp_ui_destroy(ui);
        lvp_destroy(ctx);
    }
    lv_deinit();
    puts("C: locale/font/custom widget/animation and transactional bundle checks passed");
    return 0;
}
