/* SPDX-License-Identifier: Apache-2.0 */
#include "lvgl.h"
#include "lvglplus_ui.h"
#include <assert.h>
#include <stdio.h>
#include <string.h>
static const lvp_signal_def signals[] = {
    {"source",LVP_INTEGER,0,"",0,0,NULL,0,"",NULL},
    {"modal",LVP_BOOLEAN,1,"",0,0,NULL,0,"",NULL}
};
static const uint32_t order[] = {0,1};
static const lvp_command_def commands[] = {{"dismiss",1,1},{"open",1,0}};
static const lvp_property root[] = {{"lazy","true"},{"retain","false"},{"bg","#000000"},{"input.back","open"}};
static const lvp_property image[] = {{"x","0"},{"y","0"},{"width","8"},{"height","8"}};
static const lvp_property modal[] = {{"modal","true"},{"priority","100"},{"input.back","dismiss"},{"width","10"},{"height","10"}};
static const lvp_binding_def hidden[] = {{LVP_BIND_HIDDEN,1,0,""}};
static const lvp_node_def nodes[] = {
    {"home",0,-1,"",root,4,NULL,0},
    {"frame",7,0,"",image,4,NULL,0},
    {"dialog",0,0,"",modal,5,hidden,1},
    {"other",0,-1,"",root,4,NULL,0},
    {"otherFrame",7,3,"",image,4,NULL,0},
    {"lateHome",1,0,"",NULL,0,NULL,0},
};
static const lvp_schema schema = {4,80,60,"home",signals,2,order,commands,2,nodes,6,NULL};
static int created,entered,left,destroyed,opened,closed,ticked;
static void lifecycle(lvp_ui *ui,const char *page,lvp_ui_lifecycle_event event,void *user) {
    (void)ui;(void)page;(void)user;
    if(event==LVP_UI_CREATE)created++;
    if(event==LVP_UI_ENTER)entered++;
    if(event==LVP_UI_LEAVE)left++;
    if(event==LVP_UI_DESTROY)destroyed++;
}
static lvp_result open_app(lvp_context *ctx,lvp_ui *ui,void **state) {(void)ctx;(void)ui;*state=&opened;opened++;return LVP_OK;}
static void tick_app(lvp_context *ctx,lvp_ui *ui,uint64_t now,void *state) {(void)ctx;(void)ui;(void)now;assert(state==&opened);ticked++;}
static void close_app(lvp_context *ctx,lvp_ui *ui,void *state) {(void)ctx;(void)ui;assert(state==&opened);closed++;}
static const lvp_application app={open_app,tick_app,close_app};
int main(void) {
    lvp_context *ctx;
    lvp_ui *ui;
    uint8_t frame[8*8*4];
    int32_t x,y,w,h;
    lv_init();
    assert(lvp_register_application(&app)==LVP_OK);
    ctx=lvp_create(&schema,NULL);assert(ctx);
    ui=lvp_ui_create(ctx);assert(ui);assert(opened==1);
    lvp_ui_set_lifecycle(ui,lifecycle,NULL);
    assert(lvp_ui_resident_nodes(ui)==4);
    assert(lvp_ui_bounds(ui,4,&x,&y,&w,&h)==LVP_RANGE);
    memset(frame,0,sizeof(frame));
    for(unsigned i=0;i<64;i++){frame[i*4+2]=255;frame[i*4+3]=255;}
    assert(lvp_ui_frame(ui,"frame",frame,sizeof(frame),8,8,32,LVP_FRAME_BGRA8888)==LVP_OK);
    memset(frame,0,sizeof(frame)); /* input is copied */
    assert(lvp_ui_frame(ui,"frame",frame,2,8,8,32,LVP_FRAME_BGRA8888)==LVP_RANGE);
    assert(lvp_ui_frame(ui,"frame",frame,sizeof(frame),8,8,UINT32_MAX,LVP_FRAME_BGRA8888)==LVP_RANGE);
    assert(lvp_ui_frame(ui,"home",frame,sizeof(frame),8,8,32,LVP_FRAME_BGRA8888)==LVP_TYPE);
    lvp_ui_tick(ui,0);
    assert(lvp_ui_pixels(ui)[2]==255);
    assert(lvp_ui_action(ui,"back")>0); /* root opens visible modal (hidden=0) */
    assert(lvp_get(ctx,1)->number==0);
    lvp_set_number(ctx,1,0,0,LVP_VALID);
    assert(lvp_ui_action(ui,"up")==LVP_NOT_FOUND); /* modal blocks fallback */
    assert(lvp_ui_action(ui,"back")>0);
    assert(lvp_get(ctx,1)->number==1);
    assert(lvp_ui_push(ui,"missing")==LVP_NOT_FOUND);
    assert(lvp_ui_push(ui,"other")==LVP_OK);
    assert(lvp_ui_resident_nodes(ui)==2);
    assert(lvp_ui_frame(ui,"frame",frame,sizeof(frame),8,8,32,LVP_FRAME_BGRA8888)==LVP_NOT_FOUND);
    assert(lvp_ui_back(ui)==LVP_OK);
    assert(lvp_ui_back(ui)==LVP_NOT_FOUND);
    assert(lvp_ui_resident_nodes(ui)==4);
    for(unsigned i=0;i<100;i++) {
        assert(lvp_ui_navigate(ui,"other")==LVP_OK);
        lvp_set_number(ctx,1,i%2,i,LVP_VALID);
        assert(lvp_ui_navigate(ui,"home")==LVP_OK);
    }
    assert(created==202 && entered==202 && left==202 && destroyed==202);
    assert(ticked>0);
    lvp_ui_destroy(ui);assert(closed==1);
    lvp_destroy(ctx);lv_deinit();
    puts("lazy pages, balanced subscriptions, lifecycle, navigation, modal input and copied media frames passed");
}
