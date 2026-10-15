/* SPDX-License-Identifier: Apache-2.0 */
#include "lvgl.h"
#include "lvglplus_ui.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#ifdef LVP_GENERATED
#include "ui_gen.h"
#endif
static const char *option(int argc, char **argv, const char *key) {
    int i;
    for (i = 1; i + 1 < argc; i++)
        if (!strcmp(argv[i], key))
            return argv[i + 1];
    return NULL;
}
int main(int argc, char **argv) {
    const char *path = option(argc, argv, "--package"), *output = option(argc, argv, "--out"),
               *updates = option(argc, argv, "--updates"), *at = option(argc, argv, "--at"),
               *tree = option(argc, argv, "--tree");
    const lvp_schema *schema = NULL;
    lvp_package *package = NULL;
    lvp_context *context;
    lvp_ui *ui;
    uint64_t now = at ? (uint64_t)strtoull(at, NULL, 10) : 0;
    uint32_t i;
    if (path) {
        FILE *f = fopen(path, "rb");
        long size;
        uint8_t *data;
        char error[256];
        if (!f) {
            perror(path);
            return 1;
        }
        fseek(f, 0, SEEK_END);
        size = ftell(f);
        rewind(f);
        if (size < 0 || size > 8 * 1024 * 1024) {
            fclose(f);
            return 1;
        }
        data = malloc((size_t)size);
        if (!data || fread(data, 1, (size_t)size, f) != (size_t)size) {
            fclose(f);
            free(data);
            return 1;
        }
        fclose(f);
        package = lvp_package_load(data, (size_t)size, error, sizeof(error));
        free(data);
        if (!package) {
            fprintf(stderr, "%s\n", error);
            return 1;
        }
        schema = lvp_package_schema(package);
    }
#ifdef LVP_GENERATED
    else
        schema = &LVP_SCHEMA;
#endif
    if (!schema) {
        fprintf(stderr, "Pass --package file.lvp or build with LVP_UI_DIR\n");
        return 2;
    }
    lv_init();
#ifdef LVP_CUSTOM
    {
        extern void lvp_register_custom_widgets(void);
        lvp_register_custom_widgets();
    }
#endif
    context = lvp_create(schema, NULL);
    if (!context) {
        lvp_package_free(package);
        return 1;
    }
    if (updates) {
        FILE *f = fopen(updates, "rb");
        char line[2048];
        if (!f) {
            perror(updates);
            lvp_destroy(context);
            lvp_package_free(package);
            return 1;
        }
        lvp_batch_begin(context);
        while (fgets(line, sizeof(line), f)) {
            char *name = line, *value = strchr(line, '\t'), *q;
            int32_t index;
            lvp_result result;
            if (!value) {
                fprintf(stderr, "Invalid update\n");
                fclose(f);
                return 1;
            }
            *value++ = 0;
            q = strchr(value, '\t');
            if (q)
                *q++ = 0;
            index = lvp_find(context, name);
            if (index < 0 || !value || !q) {
                fprintf(stderr, "Invalid update\n");
                fclose(f);
                return 1;
            }
            if (schema->signals[index].type == LVP_STRING)
                result = lvp_set_string(context, (uint32_t)index, value, now, (lvp_quality)atoi(q));
            else
                result =
                    lvp_set_number(context, (uint32_t)index, strtod(value, NULL), now, (lvp_quality)atoi(q));
            if (result != LVP_OK) {
                fprintf(stderr, "Rejected update %s: %d\n", name, result);
                fclose(f);
                return 1;
            }
        }
        fclose(f);
        lvp_batch_end(context);
    }
    ui = lvp_ui_create(context);
    if (!ui) {
        lvp_destroy(context);
        lvp_package_free(package);
        return 1;
    }
    lvp_ui_tick(ui, 0);
    lvp_ui_tick(ui, now);
    if (output) {
        FILE *f = fopen(output, "wb");
        const uint8_t *pixels = lvp_ui_pixels(ui);
        size_t p, total = (size_t)schema->width * schema->height;
        if (!f) {
            perror(output);
            return 1;
        }
        fprintf(f, "P6\n%u %u\n255\n", schema->width, schema->height);
        for (p = 0; p < total; p++) {
            uint8_t rgb[] = {pixels[p * 4 + 2], pixels[p * 4 + 1], pixels[p * 4]};
            fwrite(rgb, 1, 3, f);
        }
        fclose(f);
    }
    if (tree) {
        FILE *f = fopen(tree, "wb");
        if (!f)
            return 1;
        for (i = 0; i < schema->node_count; i++) {
            int32_t x, y, w, h;
            lvp_ui_bounds(ui, i, &x, &y, &w, &h);
            fprintf(f, "%s\t%u\t%d\t%d\t%d\t%d\n", schema->nodes[i].id, schema->nodes[i].kind, x, y, w, h);
        }
        fclose(f);
    }
    for (i = 0; i < schema->signal_count; i++) {
        const lvp_value *v = lvp_get(context, i);
        printf("%s\t%.12g\t%u\t%s\n", schema->signals[i].name, v->number, v->quality, v->text);
    }
    lvp_ui_destroy(ui);
    lvp_destroy(context);
    lvp_package_free(package);
    lv_deinit();
    return 0;
}
