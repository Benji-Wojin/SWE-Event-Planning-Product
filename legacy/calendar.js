(function (root) {
  'use strict';
  // Dates are event-local calendar days. Elapsed durations still use timestamps.
  const formatters = new Map();
  function dayKey(value = new Date(), timeZone = 'UTC', offset = 0) {
    const zone = timeZone || 'UTC';
    let formatter = formatters.get(zone);
    if (!formatter) {
      formatter = new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' });
      if (formatters.size >= 32) formatters.clear();
      formatters.set(zone, formatter);
    }
    const parts = Object.fromEntries(formatter.formatToParts(new Date(value)).map(part => [part.type, part.value]));
    const day = `${parts.year}-${parts.month}-${parts.day}`;
    if (!offset) return day;
    const date = new Date(day + 'T12:00:00Z');
    date.setUTCDate(date.getUTCDate() + offset);
    return date.toISOString().slice(0, 10);
  }
  const wallFormatters = new Map();
  const wallStates = new Map();
  const dayOffsets = new Map();
  // An entered local minute may map to zero, one, or two instants. Round-trip
  // candidate offsets instead of interpreting the input in the viewer's zone.
  function localTimeState(value, timeZone) {
    if(typeof value!=='string'||!/^[1-9]\d{3}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)||!timeZone)return 'invalid';
    const nominal=Date.parse(value+':00Z');
    if(!Number.isFinite(nominal)||new Date(nominal).toISOString().slice(0,16)!==value)return 'invalid';
    const cacheKey=timeZone+' '+value;
    if(wallStates.has(cacheKey))return wallStates.get(cacheKey);
    try {
      let formatter=wallFormatters.get(timeZone);
      if(!formatter){
        formatter=new Intl.DateTimeFormat('en-US',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
        if(wallFormatters.size>=32)wallFormatters.clear();
        wallFormatters.set(timeZone,formatter);
      }
      const key=epoch=>{
        const p=Object.fromEntries(formatter.formatToParts(new Date(epoch)).map(part=>[part.type,part.value]));
        return `${p.year.padStart(4,'0')}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
      };
      const day=value.slice(0,10),dayCacheKey=timeZone+' '+day;
      let offsets=dayOffsets.get(dayCacheKey);
      if(!offsets){
        offsets=new Set();
        const noon=Date.parse(day+'T12:00:00Z');
        // Reuse sampled offsets for all times that day; the wider window
        // covers transitions on both sides of any local minute in the day.
        for(let hours=-60;hours<=60;hours+=6){
          const epoch=noon+hours*3600000, local=Date.parse(key(epoch)+'Z');
          if(Number.isFinite(local))offsets.add(local-epoch);
        }
        if(dayOffsets.size>=2048)dayOffsets.clear();
        dayOffsets.set(dayCacheKey,offsets);
      }
      const matches=[...offsets].filter(offset=>key(nominal-offset)===value+':00').length;
      const state=matches===1?'unique':matches?'repeated':'missing';
      if(wallStates.size>=4096)wallStates.clear();
      wallStates.set(cacheKey,state);
      return state;
    }catch{return 'invalid';}
  }
  function scheduleTimeIssue(schedule,timeZone,previous=null) {
    for(const field of ['start','end']){
      const value=schedule?.[field];
      if(!value||value===previous?.[field])continue;
      const state=localTimeState(value,timeZone);
      if(state!=='unique')return {field,value,state};
    }
    return null;
  }
  function scheduleTimeMessage(issue,timeZone,nextStep='Choose a different local time.') {
    const label=issue.field==='start'?'Start time':'End time';
    const reason=issue.state==='missing'?'does not exist':issue.state==='repeated'?'occurs twice':'is not valid';
    return `${label} ${issue.value.replace('T',' ')} ${reason} in ${timeZone}. ${nextStep}`;
  }
  root.GatherCalendar = { dayKey,localTimeState,scheduleTimeIssue,scheduleTimeMessage };
})(typeof window !== 'undefined' ? window : globalThis);
