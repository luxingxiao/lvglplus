/* SPDX-License-Identifier: Apache-2.0 */
#define _DEFAULT_SOURCE
#include "lvglplus_linux.h"
#include <errno.h>
#include <linux/can.h>
#include <linux/can/raw.h>
#include <net/if.h>
#include <string.h>
#include <sys/socket.h>
#include <unistd.h>
static void emit(const char *name, double number, uint64_t timestamp, void *user) {
    lvp_linux_can *state = user;
    int32_t signal = lvp_find(state->context, name);
    lvp_value value = {0};
    if (signal < 0)
        return;
    state->owned[signal] = 1;
    value.number = number;
    value.timestamp_ms = timestamp;
    value.quality = LVP_VALID;
    lvp_adapter_publish(state->context, state->adapter, (uint32_t)signal, &value,
                        state->events[signal] ? 1 : 0);
}
static void quality(lvp_linux_can *state, lvp_quality quality) {
    uint32_t i;
    const lvp_schema *schema = lvp_get_schema(state->context);
    for (i = 0; i < schema->signal_count; i++)
        if (state->owned[i]) {
            lvp_value value = *lvp_get(state->context, i);
            value.timestamp_ms = state->now;
            value.quality = quality;
            lvp_adapter_publish(state->context, state->adapter, i, &value, 0);
        }
}
static void stop(lvp_context *ctx, uint32_t id, void *user) {
    lvp_linux_can *state = user;
    (void)ctx;
    (void)id;
    if (state->fd >= 0)
        close(state->fd);
    state->fd = -1;
}
static lvp_result start(lvp_context *ctx, uint32_t id, void *user) {
    lvp_linux_can *state = user;
    struct sockaddr_can address;
    int enable = 1;
    state->context = ctx;
    state->adapter = id;
    state->fd = socket(PF_CAN, SOCK_RAW | SOCK_NONBLOCK, CAN_RAW);
    if (state->fd < 0)
        goto failed;
    if (setsockopt(state->fd, SOL_CAN_RAW, CAN_RAW_FD_FRAMES, &enable, sizeof(enable)) < 0)
        goto failed;
    memset(&address, 0, sizeof(address));
    address.can_family = AF_CAN;
    address.can_ifindex = (int)if_nametoindex(state->interface_name);
    if (!address.can_ifindex || bind(state->fd, (struct sockaddr *)&address, sizeof(address)) < 0)
        goto failed;
    lvp_adapter_set_state(ctx, id, LVP_ADAPTER_CONNECTED);
    return LVP_OK;
failed:
    stop(ctx, id, user);
    lvp_adapter_set_state(ctx, id, LVP_ADAPTER_CONNECTING);
    state->retry_at = lvp_now(ctx) + 1000;
    return LVP_OK;
}
static void poll(lvp_context *ctx, uint32_t id, uint64_t now, void *user) {
    lvp_linux_can *state = user;
    uint32_t budget = 64;
    state->now = now;
    if (state->fd < 0) {
        if (now >= state->retry_at)
            start(ctx, id, user);
        return;
    }
    while (budget--) {
        struct canfd_frame raw;
        lvp_can_frame frame;
        ssize_t length = read(state->fd, &raw, sizeof(raw));
        if (length < 0) {
            if (errno == EAGAIN || errno == EWOULDBLOCK)
                return;
            if (errno == EINTR)
                continue;
            stop(ctx, id, user);
            lvp_adapter_set_state(ctx, id, LVP_ADAPTER_CONNECTING);
            quality(state, LVP_DISCONNECTED);
            state->retry_at = now + 1000;
            return;
        }
        if ((length != CAN_MTU && length != CANFD_MTU) || (raw.can_id & (CAN_ERR_FLAG | CAN_RTR_FLAG))) {
            state->decode_errors++;
            continue;
        }
        memset(&frame, 0, sizeof(frame));
        frame.extended = !!(raw.can_id & CAN_EFF_FLAG);
        frame.id = raw.can_id & (frame.extended ? CAN_EFF_MASK : CAN_SFF_MASK);
        frame.fd = length == CANFD_MTU;
        frame.brs = frame.fd && !!(raw.flags & CANFD_BRS);
        frame.length = raw.len;
        frame.timestamp_ms = now;
        if (frame.length > 64) {
            state->decode_errors++;
            continue;
        }
        memcpy(frame.data, raw.data, frame.length);
        state->frames++;
        {
            int result = state->decode(&frame, emit, state);
            if (result < 0 && result != LVP_NOT_FOUND) {
                state->decode_errors++;
                quality(state, LVP_INVALID);
            }
        }
    }
}
int32_t lvp_linux_can_register(lvp_context *ctx, lvp_linux_can *state, const char *interface_name,
                               lvp_can_codec decode) {
    static const lvp_adapter_ops ops = {start, poll, stop};
    if (!ctx || !state || !interface_name || !decode || strlen(interface_name) > 15)
        return LVP_TYPE;
    memset(state, 0, sizeof(*state));
    state->fd = -1;
    strcpy(state->interface_name, interface_name);
    state->decode = decode;
    return lvp_adapter_register(ctx, "socketcan", &ops, state);
}
