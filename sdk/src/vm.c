/* SPDX-License-Identifier: Apache-2.0 */
#include "lvglplus.h"
#include <math.h>

static lvp_result evaluate(const lvp_instruction *code, uint32_t length, const lvp_value *values,
                           uint32_t count, double *out, lvp_quality *quality, const double *argument) {
    double stack[LVP_CODE_MAX];
    uint32_t sp = 0, i;
    lvp_quality q = LVP_VALID;
    if (!out || !quality || !code || !length || length > LVP_CODE_MAX)
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
        if (ins->op == LVP_ARGUMENT) {
            if (!argument || sp == LVP_CODE_MAX || !isfinite(*argument))
                return LVP_ERROR;
            stack[sp++] = *argument;
            continue;
        }
        if (ins->op == LVP_FIT_SCALE) {
            uint32_t n = ins->signal, base;
            double minx, maxx, miny, maxy, w, h, lo, hi, padding;
            if (!n || n > 64 || sp < 5 + 2 * n)
                return LVP_RANGE;
            base = sp - 5 - 2 * n;
            w = stack[base];
            h = stack[base + 1];
            lo = stack[base + 2];
            hi = stack[base + 3];
            padding = stack[base + 4];
            if (w <= 0 || h <= 0 || lo <= 0 || hi < lo || padding < 0)
                return LVP_RANGE;
            minx = maxx = stack[base + 5];
            miny = maxy = stack[base + 6];
            for (uint32_t j = 1; j < n; j++) {
                minx = fmin(minx, stack[base + 5 + j * 2]);
                maxx = fmax(maxx, stack[base + 5 + j * 2]);
                miny = fmin(miny, stack[base + 6 + j * 2]);
                maxy = fmax(maxy, stack[base + 6 + j * 2]);
            }
            r = fmax(lo,
                     fmin(hi, fmin(w / fmax(1, maxx - minx + padding), h / fmax(1, maxy - miny + padding))));
            sp = base;
            stack[sp++] = r;
            continue;
        }
        if (ins->op == LVP_CONST) {
            if (sp == LVP_CODE_MAX || !isfinite(ins->value))
                return LVP_RANGE;
            stack[sp++] = ins->value;
            continue;
        }
        if (ins->op == LVP_LOAD) {
            if (ins->signal >= count || sp == LVP_CODE_MAX)
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
        if (ins->op == LVP_SIN || ins->op == LVP_COS || ins->op == LVP_SQRT || ins->op == LVP_ABS ||
            ins->op == LVP_FLOOR || ins->op == LVP_CEIL) {
            if (!sp)
                return LVP_ERROR;
            a = stack[sp - 1];
            switch (ins->op) {
            case LVP_SIN:
                r = sin(a);
                break;
            case LVP_COS:
                r = cos(a);
                break;
            case LVP_SQRT:
                if (a < 0)
                    return LVP_RANGE;
                r = sqrt(a);
                break;
            case LVP_ABS:
                r = fabs(a);
                break;
            case LVP_FLOOR:
                r = floor(a);
                break;
            default:
                r = ceil(a);
                break;
            }
            if (!isfinite(r))
                return LVP_RANGE;
            stack[sp - 1] = r;
            continue;
        }
        if (ins->op == LVP_CLAMP) {
            if (sp < 3)
                return LVP_ERROR;
            b = stack[--sp];
            a = stack[--sp];
            r = stack[--sp];
            if (a > b)
                return LVP_RANGE;
            stack[sp++] = fmax(a, fmin(b, r));
            continue;
        }
        if (ins->op >= LVP_CLUSTER_ID && ins->op <= LVP_CLUSTER_Y) {
            uint32_t n = ins->signal, base, parent[64], target, root, total = 0;
            double radius, sumx = 0, sumy = 0;
            if (!n || n > 64 || sp < 2 + 2 * n)
                return LVP_RANGE;
            base = sp - 2 - 2 * n;
            radius = stack[base + 1];
            if (stack[base] < 0 || stack[base] >= n || trunc(stack[base]) != stack[base] || radius < 0)
                return LVP_RANGE;
            target = (uint32_t)stack[base];
            for (uint32_t j = 0; j < n; j++)
                parent[j] = j;
            for (uint32_t j = 0; j < n; j++)
                for (uint32_t k = j + 1; k < n; k++) {
                    if (hypot(stack[base + 2 + j * 2] - stack[base + 2 + k * 2],
                              stack[base + 3 + j * 2] - stack[base + 3 + k * 2]) <= radius) {
                        uint32_t x = j, y = k;
                        while (parent[x] != x)
                            x = parent[x];
                        while (parent[y] != y)
                            y = parent[y];
                        if (x < y)
                            parent[y] = x;
                        else
                            parent[x] = y;
                    }
                }
            root = target;
            while (parent[root] != root)
                root = parent[root];
            for (uint32_t j = 0; j < n; j++) {
                uint32_t x = j;
                while (parent[x] != x)
                    x = parent[x];
                if (x == root) {
                    total++;
                    sumx += stack[base + 2 + j * 2];
                    sumy += stack[base + 3 + j * 2];
                }
            }
            r = ins->op == LVP_CLUSTER_ID     ? root
                : ins->op == LVP_CLUSTER_SIZE ? total
                : ins->op == LVP_CLUSTER_X    ? sumx / total
                                              : sumy / total;
            if (!isfinite(r))
                return LVP_RANGE;
            sp = base;
            stack[sp++] = r;
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
        case LVP_ATAN2:
            r = atan2(a, b);
            break;
        case LVP_HYPOT:
            r = hypot(a, b);
            break;
        case LVP_MIN:
            r = fmin(a, b);
            break;
        case LVP_MAX:
            r = fmax(a, b);
            break;
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

lvp_result lvp_evaluate(const lvp_instruction *code, uint32_t length, const lvp_value *values, uint32_t count,
                        double *out, lvp_quality *quality) {
    return evaluate(code, length, values, count, out, quality, NULL);
}
lvp_result lvp_evaluate_argument(const lvp_instruction *code, uint32_t length, const lvp_value *values,
                                 uint32_t count, double argument, double *out, lvp_quality *quality) {
    return evaluate(code, length, values, count, out, quality, &argument);
}
