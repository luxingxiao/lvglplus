/* SPDX-License-Identifier: Apache-2.0 */
#include "lvglplus.h"
#include <assert.h>
#include <stdio.h>
static const lvp_signal_def signals[] = {{"a", LVP_NUMBER, 1, "", 0, 0, NULL, 0, "", NULL},
                                         {"b", LVP_NUMBER, 2, "", 0, 0, NULL, 0, "", NULL},
                                         {"running", LVP_BOOLEAN, 1, "", 0, 0, NULL, 0, "", NULL},
                                         {"rate", LVP_NUMBER, 1, "", 0, 0, NULL, 0, "", NULL},
                                         {"time.ms", LVP_NUMBER, 0, "", 0, 0, NULL, 0, "", NULL},
                                         {"counter", LVP_INTEGER, 0, "", 0, 0, NULL, 0, "", NULL}};
static const uint32_t order[] = {0, 1, 2, 3, 4, 5};
static const lvp_instruction yes[] = {{LVP_CONST, 0, 1}}, a[] = {{LVP_LOAD, 0, 0}}, b[] = {{LVP_LOAD, 1, 0}},
                             bad[] = {{LVP_CONST, 0, 1}, {LVP_CONST, 0, 0}, {LVP_DIV, 0, 0}},
                             inc[] = {{LVP_LOAD, 5, 0}, {LVP_CONST, 0, 1}, {LVP_ADD, 0, 0}};
static const lvp_assignment swap[] = {{0, b, 1}, {1, a, 1}}, fail[] = {{0, yes, 1}, {1, bad, 3}},
                            count[] = {{5, inc, 3}};
static const lvp_action_def actions[] = {
    {"swap", yes, 1, swap, 2}, {"fail", yes, 1, fail, 2}, {"count", yes, 1, count, 1}};
static const lvp_command_def commands[] = {{"swap", -1, 0}, {"fail", -1, 0}, {"count", -1, 0}};
static const lvp_clock_def clocks[] = {{4, 2, 3}};
static const lvp_timer_def timers[] = {{4, 100, "count"}};
static const lvp_program program = {actions, 3, clocks, 1, timers, 1};
static const lvp_schema schema = {3, 10, 10, "home", signals, 6, order, commands, 3, NULL, 0, &program};
int main(void) {
    lvp_context *c = lvp_create(&schema, NULL);
    assert(c);
    lvp_batch_begin(c);
    int32_t nested = lvp_command(c, "swap");
    assert(nested > 0 && lvp_command_state(c, nested) == LVP_COMMAND_FAILED);
    lvp_batch_end(c);
    int32_t id = lvp_command(c, "swap");
    assert(id > 0 && lvp_command_state(c, id) == LVP_COMMAND_SUCCEEDED);
    assert(lvp_get(c, 0)->number == 2 && lvp_get(c, 1)->number == 1);
    id = lvp_command(c, "fail");
    assert(lvp_command_state(c, id) == LVP_COMMAND_FAILED);
    assert(lvp_get(c, 0)->number == 2 && lvp_get(c, 1)->number == 1); /* no partial commit */
    lvp_tick(c, 1000);
    lvp_tick(c, 1250);
    assert(lvp_get(c, 4)->number == 250 && lvp_get(c, 5)->number == 2);
    lvp_set_number(c, 2, 0, 1250, LVP_VALID);
    lvp_tick(c, 2250);
    assert(lvp_get(c, 4)->number == 250);
    lvp_set_number(c, 2, 1, 2250, LVP_VALID);
    lvp_set_number(c, 3, 2, 2250, LVP_VALID);
    lvp_tick(c, 2350);
    assert(lvp_get(c, 4)->number == 450 && lvp_get(c, 5)->number == 4);
    lvp_tick(c, 12350);
    assert(lvp_timing(c).deferred > 0);
    assert(lvp_timing(c).failures == 0);
    for (int i = 0; i < 8; i++)
        lvp_tick(c, 12350);
    assert(lvp_timing(c).deferred == 0 && lvp_get(c, 5)->number == 204);
    lvp_set_number(c, 4, 0, 12350, LVP_VALID);
    lvp_tick(c, 12350);
    lvp_tick(c, 12400);
    assert(lvp_get(c, 5)->number == 205);
    lvp_instruction math[] = {{LVP_CONST, 0, 3}, {LVP_CONST, 0, 4}, {LVP_HYPOT, 0, 0}};
    double out;
    lvp_quality q;
    assert(lvp_evaluate(math, 3, NULL, 0, &out, &q) == LVP_OK && out == 5);
    lvp_destroy(c);
    lvp_program broken = program;
    lvp_clock_def wrong = {999, -1, -1};
    broken.clocks = &wrong;
    lvp_schema s = schema;
    s.program = &broken;
    assert(!lvp_create(&s, NULL));
    puts("Program atomicity, clocks, pause/rate, ordered catchup, reset, math and malformed schema passed.");
    return 0;
}
