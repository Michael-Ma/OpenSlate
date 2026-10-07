import test from "node:test";
import assert from "node:assert/strict";
import {supportedLocale,resolveLocale,localeHref,readLocalePreference,persistLocalePreference,LOCALE_STORAGE_KEY,translate,translateUiText} from "../src/locale-model.ts";
import {commonUiTranslations} from "../src/locale-ui-messages.ts";
import {errorMessage} from "../src/model.ts";

test("language priority is explicit URL, saved choice, supported browser preference then English",()=>{
 assert.equal(resolveLocale("?mode=night&lang=zh", "en", ["en-US"]),"zh-CN");
 assert.equal(resolveLocale("?lang=en", "zh-CN", ["zh-TW"]),"en");
 assert.equal(resolveLocale("?lang=fr", "zh-CN", ["en-US"]),"zh-CN");
 assert.equal(resolveLocale("", null, ["de-DE","zh-TW","en-US"]),"zh-CN");
 assert.equal(resolveLocale("", null, ["en-GB","zh-CN"]),"en");
 assert.equal(resolveLocale("", null, ["fr-FR"]),"en");
 assert.equal(supportedLocale("ja"),null);assert.equal(supportedLocale({locale:"en"}),null);
});
test("blocked storage does not prevent language selection and preferences use a separate browser key",()=>{
 const values=new Map(),storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
 assert.equal(persistLocalePreference(storage,"zh-CN"),true);assert.equal(values.get(LOCALE_STORAGE_KEY),"zh-CN");assert.equal(readLocalePreference(storage),"zh-CN");
 const denied={getItem(){throw Error("blocked");},setItem(){throw Error("blocked");}};
 assert.equal(readLocalePreference(denied),null);assert.equal(persistLocalePreference(denied,"en"),false);assert.equal(persistLocalePreference(null,"en"),false);
});
test("language links retain theme, view, stable selection, unrelated context and fragment",()=>{
 const original="http://127.0.0.1:3001/?mode=night&view=frames&shot=stable-shot&context=example#saved-reference";
 const next=new URL(localeHref(original,"zh-CN"));assert.equal(next.searchParams.get("lang"),"zh-CN");assert.equal(next.searchParams.get("mode"),"night");assert.equal(next.searchParams.get("view"),"frames");assert.equal(next.searchParams.get("shot"),"stable-shot");assert.equal(next.searchParams.get("context"),"example");assert.equal(next.hash,"#saved-reference");
 assert.equal(new URL(localeHref(next.href,"en")).searchParams.getAll("lang").length,1);
});
test("interpolation preserves user values literally and does not recursively substitute them",()=>{
 const values={name:"皮革 {count} <b>detail</b>",count:3};const before=structuredClone(values);
 assert.equal(translate("zh-CN","Review {name}: {count} shots","检查 {name}：{count} 个镜头",values),"检查 皮革 {count} <b>detail</b>：3 个镜头");
 assert.equal(translate("en","Review {name}: {count} shots","unused",values),"Review 皮革 {count} <b>detail</b>: 3 shots");assert.deepEqual(values,before);
 assert.equal(translate("en","{unknown}","",{}),"{unknown}");
});
test("only whitelisted UI messages translate; arbitrary project, provider and conversation content is retained",()=>{
 const catalog={"Saved":"已保存","Generate video":"生成视频"};
 assert.equal(translateUiText("Saved","zh-CN",catalog),"已保存");assert.equal(translateUiText("已保存","en",catalog),"Saved");
 for(const content of ["Iron Boots · 皮革广告","gpt-image-production","Saved: my personal scene","调整纹理，让画面更安静。"]){assert.equal(translateUiText(content,"en",catalog),content);assert.equal(translateUiText(content,"zh-CN",catalog),content);}
});
test("visible controlled error messages can switch language without replacing their saved error or command",()=>{
 const command={key:"same-command",body:{headVersion:12,kind:"video",reviewedFrames:[{shotId:"shot-1",artifactId:"image-1",sha256:"a".repeat(64)}]}};
 const original=JSON.stringify(command);
 for(const code of ["AUTH_REQUIRED","REVISION_CONFLICT","MEDIA_NARRATION_REQUIRED","DIRECTOR_SETUP_REQUIRED","NETWORK_ERROR","UNKNOWN"]){const message=errorMessage(code),chinese=translateUiText(message,"zh-CN",commonUiTranslations);assert.notEqual(chinese,message);assert.equal(translateUiText(chinese,"en",commonUiTranslations),message);}
 assert.equal(JSON.stringify(command),original);
});
