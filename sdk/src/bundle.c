/* SPDX-License-Identifier: Apache-2.0 */
#include "lvglplus.h"
#include <stdio.h>
#include <string.h>
static uint32_t word(const uint8_t *b) {
    return (uint32_t)b[0] | (uint32_t)b[1] << 8 | (uint32_t)b[2] << 16 | (uint32_t)b[3] << 24;
}
lvp_package *lvp_bundle_load(const uint8_t *bytes, size_t size, char *error, size_t cap) {
    uint32_t crc = 0xffffffff;
    size_t i;
    int bit;
    if (!bytes || size < 32 || memcmp(bytes, "LVPB", 4) || word(bytes + 4) != 1 || word(bytes + 8) != 1 ||
        word(bytes + 12) != 0x090500 || word(bytes + 16) != size - 32) {
        if (error && cap)
            snprintf(error, cap, "Incompatible bundle header");
        return NULL;
    }
    for (i = 32; i < size; i++) {
        crc ^= bytes[i];
        for (bit = 0; bit < 8; bit++)
            crc = (crc >> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    if ((crc ^ 0xffffffff) != word(bytes + 20)) {
        if (error && cap)
            snprintf(error, cap, "Bundle CRC mismatch");
        return NULL;
    }
    return lvp_package_load(bytes + 32, size - 32, error, cap);
}
