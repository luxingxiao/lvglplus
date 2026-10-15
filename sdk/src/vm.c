/* SPDX-License-Identifier: Apache-2.0 */
#include "lvglplus.h"
#include <math.h>

lvp_result lvp_evaluate(const lvp_instruction *code, uint32_t length, const lvp_value *values, uint32_t count,
                        double *out, lvp_quality *quality) {
    double stack[96];
    uint32_t sp = 0, i;
    lvp_quality q = LVP_VALID;
    if (!out || !quality || !code || !length || length > 96)
        return LVP_ERROR;
    for (i = 0; i < length; i++) {
        const lvp_instruction *ins = &code[i];
        double a, b, r;
        if (ins->op == LVP_JUMP || ins->op == LVP_JUMP_FALSE) {
            int take = 1;
            if (ins->signal >= length || i + ins->signal >= length)
                return LVP_RANGE;
            if (ins->op == LVP_JUMP_FALSE) {
                if (!sp)
                    return LVP_ERROR;
                take = !stack[--sp];
            }
            if (take)
                i += ins->signal;
            continue;
        }
        if (ins->op == LVP_CONST) {
            if (sp == 96 || !isfinite(ins->value))
                return LVP_RANGE;
            stack[sp++] = ins->value;
            continue;
        }
        if (ins->op == LVP_LOAD) {
            if (ins->signal >= count || sp == 96)
                return LVP_RANGE;
            stack[sp++] = values[ins->signal].number;
            if (values[ins->signal].quality > q)
                q = values[ins->signal].quality;
            continue;
        }
        if (ins->op == LVP_NEG || ins->op == LVP_NOT) {
            if (!sp)
                return LVP_ERROR;
            stack[sp - 1] = ins->op == LVP_NEG ? -stack[sp - 1] : !stack[sp - 1];
            continue;
        }
        if (ins->op == LVP_SELECT) {
            if (sp < 3)
                return LVP_ERROR;
            b = stack[--sp];
            a = stack[--sp];
            r = stack[--sp];
            stack[sp++] = r ? a : b;
            continue;
        }
        if (sp < 2)
            return LVP_ERROR;
        b = stack[--sp];
        a = stack[--sp];
        switch (ins->op) {
        case LVP_ADD:
            r = a + b;
            break;
        case LVP_SUB:
            r = a - b;
            break;
        case LVP_MUL:
            r = a * b;
            break;
        case LVP_DIV:
            if (b == 0)
                return LVP_RANGE;
            r = a / b;
            break;
        case LVP_MOD:
            if (b == 0)
                return LVP_RANGE;
            r = fmod(a, b);
            break;
        case LVP_EQ:
            r = a == b;
            break;
        case LVP_NE:
            r = a != b;
            break;
        case LVP_LT:
            r = a < b;
            break;
        case LVP_LE:
            r = a <= b;
            break;
        case LVP_GT:
            r = a > b;
            break;
        case LVP_GE:
            r = a >= b;
            break;
        case LVP_AND:
            r = (a != 0) && (b != 0);
            break;
        case LVP_OR:
            r = (a != 0) || (b != 0);
            break;
        default:
            return LVP_ERROR;
        }
        if (!isfinite(r))
            return LVP_RANGE;
        stack[sp++] = r;
    }
    if (sp != 1 || !isfinite(stack[0]))
        return LVP_ERROR;
    *out = stack[0];
    *quality = q;
    return LVP_OK;
}
