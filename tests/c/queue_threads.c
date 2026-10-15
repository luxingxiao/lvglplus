/* SPDX-License-Identifier: Apache-2.0 */
#include "lvglplus.h"
#include <assert.h>
#include <pthread.h>
#include <sched.h>
#include <stdio.h>
typedef struct {
    pthread_mutex_t mutex;
    lvp_context *context;
    int done;
} state;
static uint32_t delivered;
static void observe(lvp_context *ctx, uint32_t signal, const lvp_value *value, void *user) {
    (void)ctx;
    (void)signal;
    (void)value;
    (void)user;
    delivered++;
}
static void lock(void *user) {
    pthread_mutex_lock(&((state *)user)->mutex);
}
static void unlock(void *user) {
    pthread_mutex_unlock(&((state *)user)->mutex);
}
static void *produce(void *user) {
    state *s = user;
    for (int i = 0; i < 2000; i++) {
        lvp_value value = {0};
        value.number = i;
        value.timestamp_ms = (uint64_t)i;
        while (lvp_post(s->context, 0, &value, 1) == LVP_FULL)
            sched_yield();
    }
    lock(s);
    s->done++;
    unlock(s);
    return NULL;
}
int main(void) {
    const lvp_signal_def signal = {"speed", LVP_NUMBER, 0, "", 0, 0, NULL, 0, "km/h", NULL};
    const uint32_t order = 0;
    const lvp_schema schema = {1, 1, 1, "", &signal, 1, &order, NULL, 0, NULL, 0};
    state s = {0};
    lvp_hal hal = {0};
    pthread_t a, b;
    int done = 0;
    assert(!pthread_mutex_init(&s.mutex, NULL));
    hal.user = &s;
    hal.lock = lock;
    hal.unlock = unlock;
    hal.queue_capacity = 16;
    s.context = lvp_create(&schema, &hal);
    assert(s.context);
    assert(lvp_subscribe(s.context, 0, observe, NULL));
    assert(!pthread_create(&a, NULL, produce, &s));
    assert(!pthread_create(&b, NULL, produce, &s));
    for (uint64_t time = 0; !done || lvp_stats(s.context).pending; time++) {
        lvp_tick(s.context, time);
        lock(&s);
        done = s.done == 2;
        unlock(&s);
    }
    pthread_join(a, NULL);
    pthread_join(b, NULL);
    assert(lvp_stats(s.context).posted == 4000);
    assert(lvp_stats(s.context).processed == 4000);
    assert(delivered == 4000);
    lvp_destroy(s.context);
    pthread_mutex_destroy(&s.mutex);
    puts("threaded ingress: 4000 events, bounded queue, no lost accepted events");
    return 0;
}
