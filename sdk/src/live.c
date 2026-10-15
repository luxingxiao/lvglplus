/* SPDX-License-Identifier: Apache-2.0 */
#include "lvglplus_ui.h"
#include <stdio.h>
extern lvp_ui *lvp_ui_candidate(lvp_ui *, lvp_context *);
extern void lvp_ui_commit_candidate(lvp_ui *, lvp_ui *);

lvp_result lvp_ui_replace(lvp_ui **view, lvp_context **context, lvp_package **package, const uint8_t *bytes,
                          size_t length, char *error, size_t cap) {
    lvp_package *next_package;
    lvp_context *next_context;
    lvp_ui *next_ui;
    uint32_t i;
    if (!view || !context || !package)
        return LVP_TYPE;
    next_package = lvp_bundle_load(bytes, length, error, cap);
    if (!next_package)
        return LVP_ERROR;
    next_context = lvp_create(lvp_package_schema(next_package), NULL);
    if (!next_context) {
        lvp_package_free(next_package);
        return LVP_ERROR;
    }
    if (*context) {
        const lvp_schema *next = lvp_get_schema(next_context), *old = lvp_get_schema(*context);
        lvp_batch_begin(next_context);
        for (i = 0; i < next->signal_count; i++) {
            int32_t previous = lvp_find(*context, next->signals[i].name);
            const lvp_value *value;
            if (previous < 0 || next->signals[i].code_count ||
                next->signals[i].type != old->signals[previous].type)
                continue;
            value = lvp_get(*context, (uint32_t)previous);
            if (next->signals[i].type == LVP_STRING)
                lvp_set_string(next_context, i, value->text, value->timestamp_ms, value->quality);
            else
                lvp_set_number(next_context, i, value->number, value->timestamp_ms, value->quality);
        }
        lvp_batch_end(next_context);
    }
    next_ui = lvp_ui_candidate(*view, next_context);
    if (!next_ui) {
        lvp_destroy(next_context);
        lvp_package_free(next_package);
        if (error && cap)
            snprintf(error, cap, "Cannot create replacement view");
        return LVP_ERROR;
    }
    lvp_ui_commit_candidate(*view, next_ui);
    lvp_ui_destroy(*view);
    lvp_destroy(*context);
    lvp_package_free(*package);
    *view = next_ui;
    *context = next_context;
    *package = next_package;
    return LVP_OK;
}
