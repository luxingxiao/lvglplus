/* SPDX-License-Identifier: Apache-2.0 */
#include "lvglplus.h"
#include <assert.h>
#include <math.h>
#include <stdio.h>
#include <string.h>
static const lvp_instruction derived[] = {{LVP_LOAD, 0, 0}, {LVP_CONST, 0, 2}, {LVP_MUL, 0, 0}};
static const lvp_signal_def signals[] = {{"speed", LVP_NUMBER, 0, "", 100, 0, NULL, 0, "km/h", NULL},
                                         {"twice", LVP_NUMBER, 0, "", 0, 0, derived, 3, "", NULL},
                                         {"name", LVP_STRING, 0, "car", 0, 0, NULL, 0, "", NULL},
                                         {"enabled", LVP_BOOLEAN, 0, "", 0, 0, NULL, 0, "", NULL},
                                         {"mode", LVP_ENUM, 0, "", 0, 3, NULL, 0, "", NULL}};
static const uint32_t order[] = {0, 1, 2, 3, 4};
static const lvp_command_def commands[] = {{"enable", 3, 1}, {"remote", -1, 0}};
static const lvp_schema schema = {1, 320, 240, "home", signals, 5, order, commands, 2, NULL, 0};
static int notifications;
static void observe(lvp_context *c, uint32_t i, const lvp_value *v, void *u) {
    (void)c;
    (void)i;
    (void)u;
    assert(v->number == 40 || v->quality != LVP_VALID);
    notifications++;
}
static void remove_self(lvp_context *c, uint32_t i, const lvp_value *v, void *u) {
    (void)i;
    (void)v;
    lvp_unsubscribe(c, *(lvp_subscription **)u);
}
static lvp_command_status pending(const char *name, uint32_t id, void *u) {
    (void)name;
    (void)id;
    (void)u;
    return LVP_COMMAND_PENDING;
}
static lvp_command_status immediate(const char *name, uint32_t id, void *user) {
    (void)name;
    assert(lvp_command_complete(user, id, 1) == LVP_OK);
    return LVP_COMMAND_PENDING;
}
static void test_model(void) {
    lvp_hal hal = {0};
    lvp_context *c;
    lvp_subscription *a, *self;
    lvp_value v = {0};
    uint32_t id;
    hal.queue_capacity = 2;
    c = lvp_create(&schema, &hal);
    assert(c);
    a = lvp_subscribe(c, 1, observe, NULL);
    assert(a);
    self = lvp_subscribe(c, 0, remove_self, &self);
    assert(self);
    lvp_batch_begin(c);
    assert(lvp_set_number(c, 0, 10, 1, LVP_VALID) == LVP_OK);
    assert(lvp_set_number(c, 0, 20, 2, LVP_VALID) == LVP_OK);
    assert(!notifications);
    lvp_batch_end(c);
    assert(notifications == 1);
    assert(lvp_get(c, 1)->number == 40);
    assert(lvp_set_number(c, 1, 0, 2, LVP_VALID) == LVP_READONLY);
    assert(lvp_set_number(c, 3, 3, 2, LVP_VALID) == LVP_TYPE);
    assert(lvp_set_number(c, 0, NAN, 2, LVP_VALID) == LVP_TYPE);
    assert(lvp_set_number(c, 4, 3, 2, LVP_VALID) == LVP_TYPE);
    {
        char text[16] = "hello";
        assert(lvp_set_string(c, 2, text, 3, LVP_VALID) == LVP_OK);
        text[0] = 'x';
        assert(!strcmp(lvp_get(c, 2)->text, "hello"));
    }
    lvp_tick(c, 102);
    assert(lvp_get(c, 0)->quality == LVP_STALE);
    assert(lvp_get(c, 1)->quality == LVP_STALE);
    lvp_unsubscribe(c, a);
    v.number = 2;
    v.timestamp_ms = 103;
    v.quality = LVP_VALID;
    assert(lvp_post(c, 0, &v, 0) == LVP_OK);
    v.number = 4;
    assert(lvp_post(c, 0, &v, 0) == LVP_OK);
    assert(lvp_stats(c).coalesced == 1);
    v.number = 1;
    assert(lvp_post(c, 3, &v, 1) == LVP_OK);
    assert(lvp_post(c, 3, &v, 1) == LVP_FULL);
    assert(lvp_stats(c).overflow == 1);
    lvp_tick(c, 104);
    assert(lvp_get(c, 0)->number == 4);
    assert(lvp_get(c, 1)->number == 8);
    id = (uint32_t)lvp_command(c, "enable");
    assert(lvp_command_state(c, id) == LVP_COMMAND_SUCCEEDED);
    id = (uint32_t)lvp_command(c, "remote");
    assert(lvp_command_state(c, id) == LVP_COMMAND_FAILED);
    lvp_set_command_handler(c, pending, NULL);
    id = (uint32_t)lvp_command(c, "remote");
    assert(lvp_command_state(c, id) == LVP_COMMAND_PENDING);
    assert(lvp_command_complete(c, id, 1) == LVP_OK);
    assert(lvp_command_state(c, id) == LVP_COMMAND_SUCCEEDED);
    assert(lvp_command_complete(c, id, 1) == LVP_NOT_FOUND);
    lvp_set_command_handler(c, immediate, c);
    id = (uint32_t)lvp_command(c, "remote");
    assert(lvp_command_state(c, id) == LVP_COMMAND_SUCCEEDED);
    lvp_set_command_handler(c, pending, NULL);
    uint32_t outstanding[32];
    for (uint32_t i = 0; i < 32; i++) {
        int32_t request = lvp_command(c, "remote");
        assert(request > 0);
        outstanding[i] = (uint32_t)request;
    }
    assert(lvp_command(c, "remote") == LVP_FULL);
    assert(lvp_command_complete(c, outstanding[11], 1) == LVP_OK);
    assert(lvp_command(c, "remote") > 0);
    lvp_disconnect(c, 110);
    assert(lvp_get(c, 0)->quality == LVP_DISCONNECTED);
    assert(lvp_get(c, 1)->quality == LVP_DISCONNECTED);
    lvp_destroy(c);
}
static void test_vm(void) {
    const lvp_instruction bad[] = {{LVP_CONST, 0, 1}, {LVP_CONST, 0, 0}, {LVP_DIV, 0, 0}};
    const lvp_instruction select[] = {
        {LVP_CONST, 0, 0}, {LVP_CONST, 0, 2}, {LVP_CONST, 0, 3}, {LVP_SELECT, 0, 0}};
    double out;
    lvp_quality q;
    assert(lvp_evaluate(bad, 3, NULL, 0, &out, &q) == LVP_RANGE);
    assert(lvp_evaluate(select, 4, NULL, 0, &out, &q) == LVP_OK && out == 3);
    assert(lvp_evaluate(select, 3, NULL, 0, &out, &q) != LVP_OK);
}
static void test_can(void) {
    lvp_can_frame f = {0};
    lvp_can_signal s = {0, 16, 1, 0, 0.1, 0};
    double out;
    f.id = 0x123;
    f.length = 8;
    f.data[0] = 0xd2;
    f.data[1] = 4;
    assert(lvp_can_decode(&f, &s, &out) == LVP_OK && fabs(out - 123.4) < 0.001);
    s.start = 7;
    s.length = 16;
    s.little_endian = 0;
    f.data[0] = 0x04;
    f.data[1] = 0xd2;
    assert(lvp_can_decode(&f, &s, &out) == LVP_OK && fabs(out - 123.4) < 0.001);
    s.is_signed = 1;
    s.factor = 1;
    f.data[0] = 0xff;
    f.data[1] = 0x9c;
    assert(lvp_can_decode(&f, &s, &out) == LVP_OK && out == -100);
    f.length = 1;
    assert(lvp_can_decode(&f, &s, &out) == LVP_RANGE);
    f.length = 64;
    assert(lvp_can_validate(&f) == LVP_RANGE);
    f.fd = 1;
    assert(lvp_can_validate(&f) == LVP_OK);
    s.start = 504;
    s.length = 8;
    s.little_endian = 1;
    s.is_signed = 0;
    f.data[63] = 42;
    assert(lvp_can_decode(&f, &s, &out) == LVP_OK && out == 42);
    f.length = 9;
    assert(lvp_can_validate(&f) == LVP_RANGE);
    f.length = 8;
    f.id = 0x10000;
    assert(lvp_can_validate(&f) == LVP_RANGE);
    f.extended = 1;
    assert(lvp_can_validate(&f) == LVP_OK);
}
static void test_package(void) {
    uint8_t invalid[512] = {0};
    char message[128];
    size_t n;
    for (n = 0; n < sizeof(invalid); n++)
        assert(!lvp_package_load(invalid, n, message, sizeof(message)));
    assert(message[0]);
}
static lvp_result adapter_start(lvp_context *c, uint32_t id, void *user) {
    (void)user;
    return lvp_adapter_set_state(c, id, LVP_ADAPTER_CONNECTED);
}
static void adapter_poll(lvp_context *c, uint32_t id, uint64_t now, void *user) {
    lvp_value value = {0};
    (void)user;
    value.number = 42;
    value.timestamp_ms = now;
    assert(lvp_adapter_publish(c, id, 0, &value, 0) == LVP_OK);
}
static void adapter_stop(lvp_context *c, uint32_t id, void *user) {
    (void)c;
    (void)id;
    (*(int *)user)++;
}
static void test_adapter(void) {
    lvp_context *c = lvp_create(&schema, NULL);
    lvp_adapter_info info;
    lvp_value value = {0};
    int stopped = 0;
    lvp_adapter_ops ops = {adapter_start, adapter_poll, adapter_stop};
    int32_t id = lvp_adapter_register(c, "can", &ops, &stopped);
    assert(id == 0);
    assert(lvp_adapter_start(c, (uint32_t)id) == LVP_OK);
    lvp_tick(c, 10);
    assert(lvp_get(c, 0)->number == 42);
    value.number = 99;
    value.timestamp_ms = 10;
    assert(lvp_adapter_publish(c, 0, 0, &value, 1) == LVP_OK);
    lvp_adapter_stop(c, 0);
    assert(stopped == 1);
    assert(lvp_adapter_set_state(c, 0, LVP_ADAPTER_CONNECTED) == LVP_READONLY);
    assert(lvp_adapter_publish(c, 0, 0, &value, 1) == LVP_READONLY);
    assert(lvp_adapter_start(c, 0) == LVP_OK);
    lvp_tick(c, 20);
    assert(lvp_get(c, 0)->number == 42);
    assert(lvp_adapter_get_info(c, 0, &info) == LVP_OK);
    assert(info.received == 3 && info.dropped >= 2);
    lvp_destroy(c);
    assert(stopped == 2);
}
int main(void) {
    test_model();
    test_vm();
    test_can();
    test_package();
    test_adapter();
    puts("core: model/VM/queue/commands/CAN/package tests passed");
    return 0;
}
