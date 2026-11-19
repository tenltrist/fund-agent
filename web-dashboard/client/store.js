import {DEFAULT_FUNDS,DEFAULT_THRESHOLDS,validatePortfolio,validatePeaks} from './state.js';
import {emptyLedger,validateLedger,validateLedgerPeaks} from './ledger.js';
import {validateFlowAlerts} from './flow-model.js';
export const STORE='fund-observatory-v1';
export function persistLedger(state,input,today,persist){
  const previous=state.ledger;state.ledger=validateLedger(input,today);
  try{if(persist()===false)throw Error('持仓未保存：本机存储不可用或空间已满，请导出备份后重试');}
  catch(error){state.ledger=previous;throw error;}
}
const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
const strings=(value,limit)=>Array.isArray(value)&&value.length<=limit&&value.every(v=>typeof v==='string'&&v.length<300);
const thresholds=value=>{
  if(!object(value)||Object.keys(value).length>300)throw Error('提醒阈值格式无效');
  for(const n of Object.values(value))if(n!==null&&(!Number.isFinite(n)||n<=0||n>=100))throw Error('提醒阈值无效');
  return {...value};
};
const map=(value,name)=>{if(!object(value)||Object.keys(value).length>1000)throw Error(name+'格式无效');return value;};
export function validateBackup(value,today,{legacy=false}={}){
  if(!object(value)||(!legacy&&value.version!==1))throw Error('不支持的备份格式');
  if(!strings(value.funds,60)||value.funds.some(c=>!/^\d{6}$/.test(c)))throw Error('基金自选格式无效');
  if(!strings(value.stocks,30)||value.stocks.some(c=>!/^(sh|sz|bj)\d{6}$/.test(c)))throw Error('股票自选格式无效');
  const alerts=value.alerts??[],sent=value.sent??[];
  if(!Array.isArray(alerts)||alerts.length>1000||alerts.some(a=>!object(a)||typeof a.message!=='string'||a.message.length>2000||typeof a.time!=='string'||!Number.isFinite(Date.parse(a.time))))throw Error('提醒记录格式无效');
  if(!strings(sent,1000))throw Error('提醒去重记录格式无效');
  const ledger=validateLedger(value.ledger||emptyLedger(),today);
  const result={funds:[...new Set(value.funds)],stocks:[...new Set(value.stocks)],portfolio:value.portfolio?validatePortfolio(value.portfolio,today):null,
    thresholds:thresholds(value.thresholds||DEFAULT_THRESHOLDS),peaks:validatePeaks(value.peaks||{}),alerts:alerts.slice(0,100),sent,
    ledger,ledgerPeaks:validateLedgerPeaks(ledger,value.ledgerPeaks||{},today),ledgerThresholds:thresholds(value.ledgerThresholds||{}),
    interval:[0,30,60,300].includes(value.interval)?value.interval:30,alertThreshold:Number.isFinite(value.alertThreshold)&&value.alertThreshold>=.1&&value.alertThreshold<=30?value.alertThreshold:3,
    flowMode:value.flowMode==='browser'?'browser':'auto',flowAlerts:validateFlowAlerts(value.flowAlerts||{}),flowAlertLatches:{},
    navSeen:map(value.navSeen||{},'净值日期'),planSeen:map(value.planSeen||{},'计划日期'),
    alertReadAt:typeof value.alertReadAt==='string'?value.alertReadAt:'',lastBackupAt:typeof value.lastBackupAt==='string'?value.lastBackupAt:'',
    hideAmounts:!!value.hideAmounts,onboarded:!!value.onboarded,
    watchSort:['default','gain','loss','month','name'].includes(value.watchSort)?value.watchSort:'default'};
  return result;
}
export function loadState(storage,today){
  const defaults={version:1,funds:[...DEFAULT_FUNDS],stocks:['sh600519','sz300750','sh601318']};
  try{
    const raw=storage.getItem(STORE);
    return {state:validateBackup(raw?JSON.parse(raw):defaults,today,{legacy:true}),issue:null};
  }catch(error){
    // Keep the exact damaged input before anything can save a new default state.
    let retained=false;try{const raw=storage.getItem(STORE);if(raw){storage.setItem(STORE+'-recovery',raw);retained=true;}}catch{}
    return {state:validateBackup(defaults,today),issue:retained?'本地记录读取失败，原文件已保留。请在设置中导出恢复文件：'+error.message:'浏览器存储不可用，请启用站点存储并及时导出记录。'};
  }
}
