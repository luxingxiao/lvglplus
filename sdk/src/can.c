/* SPDX-License-Identifier: Apache-2.0 */
#include "lvglplus.h"
#include <math.h>
lvp_result lvp_can_validate(const lvp_can_frame *f) {
    if (!f || f->extended > 1 || f->fd > 1 || f->brs > 1 || f->id > (f->extended ? 0x1fffffffu : 0x7ffu) ||
        f->length > (f->fd ? 64 : 8) || (!f->fd && f->brs))
        return LVP_RANGE;
    if (f->fd && f->length > 8 && f->length != 12 && f->length != 16 && f->length != 20 && f->length != 24 &&
        f->length != 32 && f->length != 48 && f->length != 64)
        return LVP_RANGE;
    return LVP_OK;
}
lvp_result lvp_can_decode(const lvp_can_frame *f, const lvp_can_signal *s, double *out) {
    uint64_t raw = 0;
    int bit;
    uint32_t i;
    if (lvp_can_validate(f) != LVP_OK || !s || !out || !s->length || s->length > 64 || !isfinite(s->factor) ||
        !isfinite(s->offset))
        return LVP_RANGE;
    bit = s->start;
    for (i = 0; i < s->length; i++) {
        uint64_t b;
        if (bit < 0 || bit >= (int)f->length * 8)
            return LVP_RANGE;
        b = (f->data[bit / 8] >> (bit % 8)) & 1u;
        if (s->little_endian) {
            raw |= b << i;
            bit++;
        } else {
            raw = (raw << 1) | b;
            bit = bit % 8 == 0 ? bit + 15 : bit - 1;
        }
    }
    if (s->is_signed && (raw & (UINT64_C(1) << (s->length - 1)))) {
        /* Magnitude conversion avoids implementation-defined uint64 -> int64 casts. */
        uint64_t mask = s->length == 64 ? UINT64_MAX : (UINT64_C(1) << s->length) - 1;
        *out = -(double)((~raw & mask) + 1) * s->factor + s->offset;
    } else
        *out = (double)raw * s->factor + s->offset;
    return isfinite(*out) ? LVP_OK : LVP_RANGE;
}
