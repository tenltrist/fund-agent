import {FLOW_GROUPS,flowView,flowRows,flowLabel} from './flow-model.js';
const fmt=value=>Number.isFinite(value)?(value>0?'+':'')+value.toFixed(value!==0&&Math.abs(value)<.01?4:2):'—';

function bounds(range){
  const lo=Math.min(0,Number.isFinite(range.min)?range.min:0),hi=Math.max(0,Number.isFinite(range.max)?range.max:0),raw=(hi-lo||1)/5,power=10**Math.floor(Math.log10(raw)),fraction=raw/power,step=(fraction<=1?1:fraction<=2?2:fraction<=5?5:10)*power;
  return {min:Math.floor(lo/step)*step,max:Math.ceil(hi/step)*step||step};
}
export function flowChartOption(data,{period='intraday',mode='net',window='all',compact=false,width=800,overlay=null,overlayLabel='价格涨跌'}={}){
  const points=flowView(data,{period,mode,window}),ends=!compact&&width>=640;
  const option={animation:false,color:FLOW_GROUPS.map(g=>g.color),textStyle:{fontFamily:'-apple-system,PingFang SC,sans-serif',color:'#566d6a'},
    grid:{left:compact?52:62,right:ends?100:22,top:compact?42:60,bottom:compact?30:66},
    legend:{top:2,data:FLOW_GROUPS.map(g=>g.label),itemWidth:20,itemHeight:3,icon:'roundRect',itemGap:compact?12:23,textStyle:{fontSize:compact?11:12,color:'#4b6563'}},
    tooltip:{trigger:'axis',confine:true,backgroundColor:'#fff',borderColor:'#dbe4dd',axisPointer:{type:'cross',label:{backgroundColor:'#405b58'}},textStyle:{fontSize:12,color:'#304b49'},valueFormatter:value=>fmt(value)+' 亿元'},
    xAxis:{type:'category',boundaryGap:false,data:points.map(p=>p.time),axisTick:{show:false},axisLine:{lineStyle:{color:'#dce4dc'}},axisLabel:{fontSize:10,hideOverlap:true,color:'#7e918b',formatter:v=>flowLabel(v,period==='history')}},
    yAxis:{type:'value',name:'亿元',nameGap:14,scale:true,min:v=>bounds(v).min,max:v=>bounds(v).max,axisLabel:{fontSize:10,color:'#7e918b',formatter:value=>Number(value).toLocaleString('zh-CN',{maximumFractionDigits:Math.abs(value)<1?6:2})},splitLine:{lineStyle:{color:'#e9eee7',type:'dashed'}}},
    series:FLOW_GROUPS.map((g,i)=>({name:g.label,type:'line',data:points.map(p=>typeof p[g.key]==='number'&&Number.isFinite(p[g.key])?p[g.key]:null),smooth:false,connectNulls:false,showSymbol:points.length<3,symbolSize:6,lineStyle:{width:2.3,color:g.color},itemStyle:{color:g.color},emphasis:{focus:'series',lineStyle:{width:3.5}},endLabel:{show:ends,formatter:p=>g.label+' '+fmt(p.value),color:g.color,fontSize:11},labelLayout:{moveOverlap:'shiftY'},markLine:i===0?{silent:true,symbol:'none',label:{show:false},lineStyle:{color:'#8c9c95',width:1,type:'dashed'},data:[{yAxis:0}]}:undefined})),
  };
  if(!compact)option.dataZoom=[{type:'inside',filterMode:'none'},{type:'slider',height:17,bottom:8,showDetail:false,borderColor:'#e4eae1',backgroundColor:'#f4f6f1',fillerColor:'#c8d5cc55',handleStyle:{color:'#8ea99a'}}];
  // Price is a background comparison on a separate axis, not a fifth flow.
  if(overlay){const prices=new Map(flowRows(data).map((p,i)=>[p.time,overlay[i]]));option.yAxis=[option.yAxis,{type:'value',name:'价格%',axisLabel:{formatter:v=>Number(v).toFixed(1)+'%',fontSize:10,color:'#89928d'},splitLine:{show:false},scale:true}];option.grid.right=65;for(const series of option.series)series.endLabel.show=false;option.series.push({name:overlayLabel,type:'line',yAxisIndex:1,data:points.map(p=>prices.get(p.time)??null),showSymbol:false,connectNulls:false,lineStyle:{width:1.2,type:'dashed',color:'#9ca8a2'},tooltip:{valueFormatter:value=>fmt(value)+'%'}});}
  return option;
}
