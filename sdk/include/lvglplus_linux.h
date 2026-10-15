/* SPDX-License-Identifier: Apache-2.0 */
#ifndef LVGLPLUS_LINUX_H
#define LVGLPLUS_LINUX_H
#include "lvglplus.h"
#ifdef __cplusplus
extern "C" {
#endif
typedef int (*lvp_can_codec)(const lvp_can_frame *, lvp_emit_fn, void *);
/* Caller-owned state must outlive context; adapter stop closes fd, never frees state. */
typedef struct {
    int fd;
    char interface_name[16];
    lvp_can_codec decode;
    uint64_t now, retry_at;
    uint64_t frames, decode_errors;
    lvp_context *context;
    uint32_t adapter;
    uint8_t owned[LVP_SIGNAL_MAX];
    uint8_t events[LVP_SIGNAL_MAX]; /* Configure after registration: retain each edge/event. */
} lvp_linux_can;
int32_t lvp_linux_can_register(lvp_context *context, lvp_linux_can *state, const char *interface_name,
                               lvp_can_codec decode);
#ifdef __cplusplus
}
#endif
#endif
