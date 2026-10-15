/* SPDX-License-Identifier: Apache-2.0 */
#define _POSIX_C_SOURCE 200809L
#define _DEFAULT_SOURCE
#include "lvglplus.h"
#include <errno.h>
#include <linux/can.h>
#include <linux/can/raw.h>
#include <net/if.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/select.h>
#include <sys/socket.h>
#include <time.h>
#include <unistd.h>
#ifdef LVP_WITH_DBC
extern int lvp_dbc_decode(const lvp_can_frame *, lvp_emit_fn, void *);
#endif
static volatile sig_atomic_t running = 1;
static void stop(int sig) {
    (void)sig;
    running = 0;
}
static uint64_t now_ms(void) {
    struct timespec t;
    clock_gettime(CLOCK_REALTIME, &t);
    return (uint64_t)t.tv_sec * 1000 + (uint64_t)t.tv_nsec / 1000000;
}
static void emit(const char *name, double value, uint64_t timestamp, void *u) {
    (void)u;
    printf("{\"type\":\"signal\",\"signal\":\"%s\",\"value\":%.17g,\"timestampMs\":%llu,\"quality\":"
           "\"valid\"}\n",
           name, value, (unsigned long long)timestamp);
    fflush(stdout);
}
int main(int argc, char **argv) {
    int fd, enable = 1;
    struct sockaddr_can address;
    uint64_t frames = 0, errors = 0;
    if (argc != 2 || strlen(argv[1]) >= IFNAMSIZ) {
        fprintf(stderr,
                "Usage: lvp_can_gateway can0\nRead-only SocketCAN/CAN FD gateway. No transmit path.\n");
        return 2;
    }
    fd = socket(PF_CAN, SOCK_RAW, CAN_RAW);
    if (fd < 0) {
        perror("socket");
        return 1;
    }
    if (setsockopt(fd, SOL_CAN_RAW, CAN_RAW_FD_FRAMES, &enable, sizeof(enable)) < 0) {
        perror("CAN FD");
        close(fd);
        return 1;
    }
    memset(&address, 0, sizeof(address));
    address.can_family = AF_CAN;
    address.can_ifindex = (int)if_nametoindex(argv[1]);
    if (!address.can_ifindex || bind(fd, (struct sockaddr *)&address, sizeof(address)) < 0) {
        perror("bind");
        close(fd);
        return 1;
    }
    signal(SIGINT, stop);
    signal(SIGTERM, stop);
    puts("{\"type\":\"connection\",\"connected\":true}");
    fflush(stdout);
    while (running) {
        struct canfd_frame raw;
        lvp_can_frame frame;
        ssize_t n;
        fd_set reads;
        struct timeval timeout = {1, 0};
        int ready;
        FD_ZERO(&reads);
        FD_SET(fd, &reads);
        ready = select(fd + 1, &reads, NULL, NULL, &timeout);
        if (ready < 0) {
            if (errno == EINTR)
                continue;
            perror("select");
            break;
        }
        if (!ready) {
            printf("{\"type\":\"stats\",\"frames\":%llu,\"errors\":%llu}\n", (unsigned long long)frames,
                   (unsigned long long)errors);
            fflush(stdout);
            continue;
        }
        n = read(fd, &raw, sizeof(raw));
        if (n < 0) {
            if (errno == EINTR)
                continue;
            perror("read");
            break;
        }
        if (n != CAN_MTU && n != CANFD_MTU) {
            errors++;
            continue;
        }
        if (raw.can_id & (CAN_RTR_FLAG | CAN_ERR_FLAG)) {
            errors++;
            continue;
        }
        memset(&frame, 0, sizeof(frame));
        frame.extended = !!(raw.can_id & CAN_EFF_FLAG);
        frame.id = raw.can_id & (frame.extended ? CAN_EFF_MASK : CAN_SFF_MASK);
        frame.fd = n == CANFD_MTU;
        frame.brs = frame.fd && !!(raw.flags & CANFD_BRS);
        frame.length = raw.len;
        frame.timestamp_ms = now_ms();
        if (frame.length > 64) {
            errors++;
            continue;
        }
        memcpy(frame.data, raw.data, frame.length);
        if (lvp_can_validate(&frame) != LVP_OK) {
            errors++;
            continue;
        }
        frames++;
#ifdef LVP_WITH_DBC
        {
            int result = lvp_dbc_decode(&frame, emit, NULL);
            if (result != LVP_OK && result != LVP_NOT_FOUND) {
                errors++;
                puts("{\"type\":\"decode-error\"}");
                fflush(stdout);
            }
        }
#else
        {
            unsigned i;
            printf("{\"type\":\"frame\",\"id\":%u,\"extended\":%s,\"fd\":%s,\"timestampMs\":%llu,\"data\":\"",
                   frame.id, frame.extended ? "true" : "false", frame.fd ? "true" : "false",
                   (unsigned long long)frame.timestamp_ms);
            for (i = 0; i < frame.length; i++)
                printf("%02x", frame.data[i]);
            puts("\"}");
            fflush(stdout);
        }
#endif
    }
    close(fd);
    puts("{\"type\":\"connection\",\"connected\":false}");
    return running ? 1 : 0;
}
