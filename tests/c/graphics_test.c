/* SPDX-License-Identifier: Apache-2.0 */
#include "lvgl.h"
#include "lvglplus_ui.h"
#include <assert.h>
#include <stdio.h>
static const lvp_signal_def signals[] = {{"point", LVP_NUMBER, 20, "", 0, 0, NULL, 0, "", NULL},
                                         {"angle", LVP_NUMBER, 0, "", 0, 0, NULL, 0, "", NULL}};
static const uint32_t order[] = {0, 1};
static const lvp_property root[] = {{"bg", "#071512"}, {"input.right", "rotate"}};
static const lvp_property path[] = {{"x", "10"},
                                    {"y", "10"},
                                    {"width", "100"},
                                    {"height", "80"},
                                    {"points", "0,0 20,20 60,0"},
                                    {"curve", "catmull-rom"}};
static const lvp_property polygon[] = {
    {"x", "130"},     {"y", "10"},     {"width", "40"}, {"height", "50"}, {"points", "20,0 38,48 20,30 2,48"},
    {"pivotX", "20"}, {"pivotY", "25"}};
static const lvp_property sector[] = {{"x", "10"},      {"y", "90"},      {"width", "80"},
                                      {"height", "80"}, {"fade", "true"}, {"endAngle", "90"}};
static const lvp_property grid[] = {{"x", "130"},     {"y", "70"},     {"width", "80"},
                                    {"height", "80"}, {"gridX", "10"}, {"gridY", "10"}};
static const lvp_property button[] = {{"x", "220"},     {"y", "15"},           {"width", "90"},
                                      {"height", "40"}, {"text", "Set angle"}, {"command.argument", "4"}};
static const lvp_binding_def point[] = {{LVP_BIND_POINT_BASE + 3, 0, 0, ""}},
                             angle[] = {{LVP_BIND_ROTATION, 1, 0, ""}};
static const lvp_node_def nodes[] = {
    {"home", 0, -1, "", root, 2, NULL, 0},        {"path", 9, 0, "", path, 6, point, 1},
    {"polygon", 10, 0, "", polygon, 7, angle, 1}, {"sector", 11, 0, "", sector, 6, NULL, 0},
    {"grid", 12, 0, "", grid, 6, NULL, 0},        {"button", 2, 0, "angle", button, 6, NULL, 0}};
static const lvp_instruction yes[] = {{LVP_CONST, 0, 1}}, argument[] = {{LVP_ARGUMENT, 0, 0}};
static const lvp_assignment assignment[] = {{1, argument, 1}};
static const lvp_action_def actions[] = {{"angle", yes, 1, assignment, 1, 2}};
static const lvp_command_def commands[] = {{"rotate", 1, 90}, {"angle", -1, 0}};
static const lvp_program program = {actions, 1, NULL, 0, NULL, 0};
static const lvp_schema schema = {3, 320, 180, "home", signals, 2, order, commands, 2, nodes, 6, &program};
int main(void) {
    lv_init();
    for (int i = 0; i < 25; i++) {
        lvp_context *ctx = lvp_create(&schema, NULL);
        assert(ctx);
        lvp_ui *ui = lvp_ui_create(ctx);
        assert(ui);
        lvp_ui_tick(ui, 0);
        assert(lvp_ui_action(ui, "right") > 0 && lvp_get(ctx, 1)->number == 90);
        assert(lvp_set_number(ctx, 0, 60, 0, LVP_VALID) == LVP_OK);
        lvp_ui_tick(ui, 40);
        lvp_ui_pointer(ui, 250, 35, 1);
        lvp_ui_tick(ui, 80);
        lvp_ui_pointer(ui, 250, 35, 0);
        lvp_ui_tick(ui, 120);
        assert(lvp_get(ctx, 1)->number == 4);
        lvp_ui *attached = lvp_ui_attach(ctx, lv_display_get_default());
        assert(attached);
        lvp_ui_tick(attached, 140);
        lvp_ui_destroy(attached);
        lvp_ui_tick(ui, 160);
        assert(lvp_ui_pixels(ui));
        lvp_ui_destroy(ui);
        lvp_destroy(ctx);
    }
    lv_deinit();
    puts("Geometry, point/rotation binding, numeric click, semantic input and 25 attach/destroy cycles "
         "passed.");
    return 0;
}
