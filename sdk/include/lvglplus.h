/* SPDX-License-Identifier: Apache-2.0 */
#ifndef LVGLPLUS_H
#define LVGLPLUS_H
#include <stddef.h>
#include <stdint.h>
#ifdef __cplusplus
extern "C" {
#endif
#define LVP_FORMAT_VERSION 1
#define LVP_STRING_MAX 255
#define LVP_SIGNAL_MAX 256
#define LVP_NODE_MAX 512
typedef enum {
    LVP_OK = 0,
    LVP_ERROR = -1,
    LVP_TYPE = -2,
    LVP_RANGE = -3,
    LVP_READONLY = -4,
    LVP_FULL = -5,
    LVP_NOT_FOUND = -6
} lvp_result;
typedef enum { LVP_NUMBER, LVP_INTEGER, LVP_BOOLEAN, LVP_STRING, LVP_ENUM } lvp_type;
typedef enum { LVP_VALID, LVP_STALE, LVP_INVALID, LVP_DISCONNECTED } lvp_quality;
typedef enum {
    LVP_CONST,
    LVP_LOAD,
    LVP_ADD,
    LVP_SUB,
    LVP_MUL,
    LVP_DIV,
    LVP_MOD,
    LVP_NEG,
    LVP_NOT,
    LVP_EQ,
    LVP_NE,
    LVP_LT,
    LVP_LE,
    LVP_GT,
    LVP_GE,
    LVP_AND,
    LVP_OR,
    LVP_SELECT,
    LVP_JUMP_FALSE,
    LVP_JUMP
} lvp_opcode;
typedef struct {
    uint32_t op, signal;
    double value;
} lvp_instruction;
typedef struct {
    const char *name;
    uint32_t type;
    double initial;
    const char *text;
    uint32_t timeout_ms, choice_count;
    const lvp_instruction *code;
    uint32_t code_count;
    const char *unit;
    const char *const *choices;
} lvp_signal_def;
typedef struct {
    const char *name;
    int32_t signal;
    double value;
} lvp_command_def;
typedef struct {
    const char *name, *value;
} lvp_property;
typedef enum {
    LVP_BIND_TEXT,
    LVP_BIND_VALUE,
    LVP_BIND_CHECKED,
    LVP_BIND_HIDDEN,
    LVP_BIND_COLOR,
    LVP_BIND_QUALITY
} lvp_binding_kind;
typedef struct {
    uint32_t property, signal, two_way;
    const char *format;
} lvp_binding_def;
typedef struct {
    const char *id;
    uint32_t kind;
    int32_t parent;
    const char *command;
    const lvp_property *properties;
    uint32_t property_count;
    const lvp_binding_def *bindings;
    uint32_t binding_count;
} lvp_node_def;
typedef struct {
    uint32_t version, width, height;
    const char *initial_page;
    const lvp_signal_def *signals;
    uint32_t signal_count;
    const uint32_t *evaluation_order;
    const lvp_command_def *commands;
    uint32_t command_count;
    const lvp_node_def *nodes;
    uint32_t node_count;
} lvp_schema;
typedef struct {
    double number;
    char text[LVP_STRING_MAX + 1];
    uint64_t timestamp_ms;
    lvp_quality quality;
} lvp_value;
typedef struct lvp_context lvp_context;
typedef struct lvp_subscription lvp_subscription;
typedef enum {
    LVP_ADAPTER_STOPPED,
    LVP_ADAPTER_CONNECTING,
    LVP_ADAPTER_CONNECTED,
    LVP_ADAPTER_FAULT
} lvp_adapter_state;
typedef struct {
    lvp_result (*start)(lvp_context *, uint32_t adapter, void *user);
    void (*poll)(lvp_context *, uint32_t adapter, uint64_t now_ms, void *user);
    void (*stop)(lvp_context *, uint32_t adapter, void *user);
} lvp_adapter_ops;
typedef struct {
    char name[32];
    lvp_adapter_state state;
    uint64_t received, dropped, errors;
} lvp_adapter_info;
typedef void (*lvp_observer_fn)(lvp_context *, uint32_t signal, const lvp_value *, void *user);
typedef enum { LVP_COMMAND_PENDING, LVP_COMMAND_SUCCEEDED, LVP_COMMAND_FAILED } lvp_command_status;
typedef lvp_command_status (*lvp_command_fn)(const char *command, uint32_t request_id, void *user);
typedef struct {
    void *user;
    void *(*allocate)(size_t bytes, void *user);
    void (*deallocate)(void *ptr, void *user);
    /* Paired lock/unlock protect the ingress queue only. Required for multiple threads. */
    void (*lock)(void *user);
    void (*unlock)(void *user);
    void (*log)(const char *message, void *user);
    uint32_t queue_capacity;
} lvp_hal;
typedef struct {
    uint64_t posted, processed, coalesced, overflow;
    uint32_t pending;
} lvp_queue_stats;
/* Schema storage must outlive the context. All APIs except lvp_post/stats run on the UI thread. */
lvp_context *lvp_create(const lvp_schema *schema, const lvp_hal *hal);
void lvp_destroy(lvp_context *ctx);
const lvp_schema *lvp_get_schema(const lvp_context *ctx);
uint64_t lvp_now(const lvp_context *ctx);
int32_t lvp_find(const lvp_context *ctx, const char *name);
const lvp_value *lvp_get(const lvp_context *ctx, uint32_t signal);
lvp_result lvp_set_number(lvp_context *ctx, uint32_t signal, double value, uint64_t timestamp_ms,
                          lvp_quality quality);
lvp_result lvp_set_string(lvp_context *ctx, uint32_t signal, const char *value, uint64_t timestamp_ms,
                          lvp_quality quality);
void lvp_batch_begin(lvp_context *ctx);
void lvp_batch_end(lvp_context *ctx);
lvp_subscription *lvp_subscribe(lvp_context *ctx, uint32_t signal, lvp_observer_fn callback, void *user);
void lvp_unsubscribe(lvp_context *ctx, lvp_subscription *subscription);
/* Coalesce only level/state events when is_event=0. Event entries return FULL on overflow. */
lvp_result lvp_post(lvp_context *ctx, uint32_t signal, const lvp_value *value, int is_event);
lvp_queue_stats lvp_stats(lvp_context *ctx);
/* Register/start/stop/poll are UI-thread lifecycle operations. At most 8 adapters. */
int32_t lvp_adapter_register(lvp_context *ctx, const char *name, const lvp_adapter_ops *ops, void *user);
lvp_result lvp_adapter_start(lvp_context *ctx, uint32_t adapter);
void lvp_adapter_stop(lvp_context *ctx, uint32_t adapter);
lvp_result lvp_adapter_set_state(lvp_context *ctx, uint32_t adapter, lvp_adapter_state state);
lvp_result lvp_adapter_get_info(lvp_context *ctx, uint32_t adapter, lvp_adapter_info *out);
/* Publish is thread-safe with a proper HAL. Stopped/restarted source generations never leak old events. */
lvp_result lvp_adapter_publish(lvp_context *ctx, uint32_t adapter, uint32_t signal, const lvp_value *value,
                               int is_event);
void lvp_tick(lvp_context *ctx, uint64_t now_ms);
void lvp_disconnect(lvp_context *ctx, uint64_t now_ms);
void lvp_set_command_handler(lvp_context *ctx, lvp_command_fn handler, void *user);
int32_t lvp_command(lvp_context *ctx, const char *name);
lvp_result lvp_command_complete(lvp_context *ctx, uint32_t request_id, int success);
lvp_command_status lvp_command_state(const lvp_context *ctx, uint32_t request_id);
lvp_result lvp_evaluate(const lvp_instruction *code, uint32_t length, const lvp_value *values,
                        uint32_t value_count, double *out, lvp_quality *quality);
/* The binary package loader is optional; generated-C device builds do not link it. */
typedef struct lvp_package lvp_package;
lvp_package *lvp_package_load(const uint8_t *bytes, size_t size, char *error, size_t error_size);
const lvp_schema *lvp_package_schema(const lvp_package *package);
void lvp_package_free(lvp_package *package);
/* Transport-neutral CAN envelope; length is a byte count (not encoded DLC). */
typedef struct {
    uint32_t id;
    uint8_t extended, fd, brs, length;
    uint64_t timestamp_ms;
    uint8_t data[64];
} lvp_can_frame;
typedef struct {
    uint16_t start;
    uint8_t length, little_endian, is_signed;
    double factor, offset;
} lvp_can_signal;
lvp_result lvp_can_validate(const lvp_can_frame *frame);
lvp_result lvp_can_decode(const lvp_can_frame *frame, const lvp_can_signal *signal, double *value);
typedef void (*lvp_emit_fn)(const char *signal, double value, uint64_t timestamp_ms, void *user);
#ifdef __cplusplus
}
#endif
#endif
