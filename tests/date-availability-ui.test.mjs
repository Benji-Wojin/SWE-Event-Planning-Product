import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync('legacy/info-ui.js','utf8');
test('poll submission captures native form values before the save lock disables controls',async()=>{
  for(const values of [[['title','Fictional dates'],['timeZone','Asia/Tokyo'],['date','2028-03-02'],['date','2028-03-04']],[['2028-03-02','available'],['2028-03-04','maybe']]]){
    const controls=values.map(([name,value])=>({name,value,disabled:false})),handlers={},saved=[],errors=[];
    const form={controls,dataset:{},closest(){return this;},querySelector(){return {addEventListener(){}};},addEventListener(name,fn){handlers[name]=fn;}};
    class NativeFormData {
      constructor(form){this.values=form.controls.filter(control=>!control.disabled).map(control=>[control.name,control.value]);}
      get(name){return this.values.find(row=>row[0]===name)?.[1]??null;}
      getAll(name){return this.values.filter(row=>row[0]===name).map(row=>row[1]);}
    }
    const context=vm.createContext({FormData:NativeFormData,crypto,state:{revision:7},document:{getElementById:()=>form},openDialog(){},closeDialog(){},load(){},error:(_,e)=>errors.push(e.message),save:async(data)=>saved.push(data),saveLock(){for(const control of controls)control.disabled=true;return()=>{for(const control of controls)control.disabled=false;};}});
    const submitStart=source.indexOf('    async function submit('),formStart=source.indexOf('    function pollForm(');
    vm.runInContext(source.slice(submitStart,source.indexOf('    function markup()',submitStart))+source.slice(formStart,source.indexOf('    function newPollDialog()',formStart))+'globalThis.make=pollForm;',context);
    const payload=data=>({title:data.get('title'),zone:data.get('timeZone'),dates:data.getAll('date'),answer:data.get('2028-03-02'),second:data.get('2028-03-04')});
    context.make('Title','Contents',payload,'Saved');
    await handlers.submit({preventDefault(){},stopPropagation(){},submitter:{}});
    assert.deepEqual(errors,[]);assert.equal(saved.length,1);
    assert.equal(saved[0].title,values[0][0]==='title'?'Fictional dates':null);
    assert.equal(saved[0].answer,values[0][0]==='title'?null:'available');
    assert.equal(saved[0].second,values[0][0]==='title'?null:'maybe');
    assert.deepEqual(Array.from(saved[0].dates),values[0][0]==='title'?['2028-03-02','2028-03-04']:[]);
    assert.equal(saved[0].revision,7);assert.ok(saved[0].requestId);assert.ok(controls.every(control=>!control.disabled));
  }
});
