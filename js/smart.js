// 智能整理：语音转文字流水账的纯前端规则清洗、分段与栏目提取（不调任何 AI API、零 token）
// 暴露 window.Smart = { cleanText, segment, organize, extract }
(function () {
  "use strict";

  /* ---------- 第 1 步：清洗 ---------- */

  // 典型口水词（保守策略，只删这些固定说法）
  const FILLER_RE = /嗯+|呃+|额+|然后呢|就是就是|对对对|你知道吧|对吧|可以说/g;

  function cleanText(raw) {
    let text = String(raw == null ? "" : raw);

    // 口水词替换为句号（同时充当断句点），再清理因此产生的标点问题
    text = text.replace(FILLER_RE, "。");
    // 句末语气词谨慎处理：好的哈 / 行哈 / 对哦 这类 → 去「哈/哦」
    text = text.replace(/(?<=好的|好|行|对|是|没错|可以)哈/g, "");
    text = text.replace(/(?<=好的|好|行|对|是|没错|可以)哦/g, "");
    // 合并重复标点 / 错位标点
    text = text.replace(/([。！？!?，,；;、])\1+/g, "$1");
    text = text.replace(/([，,；;、])[。]/g, "。"); // 口水词紧跟逗号 → 句号
    text = text.replace(/。([，,；;])/g, "$1");
    // 中文之间的多余空格
    text = text.replace(/([^\x00-\xff])\s+([^\x00-\xff])/g, "$1$2");
    // 行首尾的多余空白与孤立标点
    text = text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .join("\n");
    text = text.replace(/^[。！？!?，,；;]+/, "").replace(/[。！？!?，,；;\s]+$/, "");

    return text.trim();
  }

  /* ---------- 第 2 步：分段 ---------- */

  const PARA_BREAK_RE = /^(上午|中午|午后|下午|晚上|今晚|深夜|凌晨|早上|今早|昨晚|夜里|半夜|傍晚|早晨)/;

  // 按句读断句、每句以句号收尾；时间词前另起一段；段落间空行
  function segment(text) {
    const sentences = String(text || "")
      .split(/[。！？!?；;]+|\n+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => s.replace(/[。！？!?；;]+$/, "") + "。");

    const paragraphs = [];
    let current = [];
    sentences.forEach((s) => {
      if (current.length && PARA_BREAK_RE.test(s)) {
        paragraphs.push(current);
        current = [];
      }
      current.push(s);
    });
    if (current.length) paragraphs.push(current);

    return paragraphs.map((p) => p.join("")).join("\n\n");
  }

  function organize(raw) {
    return segment(cleanText(raw));
  }

  /* ---------- 第 4 步：栏目提取 ---------- */

  const TIME_TOKEN_RE =
    /(\d{1,2}[:：]\d{1,2}|\d{1,2}点\d{1,2}分?|\d{1,2}点半|\d{1,2}点多|\d{1,2}点(?!\d)|[一二两三四五六七八九十]{1,3}点(?:半|\d{1,2}分?|多)?)/;

  const CN_NUM = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 十一: 11, 十二: 12 };

  const pad2 = (n) => String(n).padStart(2, "0");

  // 时间归一化为 HH:MM；模糊说法（X点多）保留原文
  function normalizeTime(raw) {
    if (!raw) return "";
    if (/多$/.test(raw)) return raw;
    let m = raw.match(/^(\d{1,2})[:：](\d{1,2})$/);
    if (m) return pad2(+m[1]) + ":" + pad2(+m[2]);
    m = raw.match(/^(\d{1,2})点(\d{1,2})分?$/);
    if (m) return pad2(+m[1]) + ":" + pad2(+m[2]);
    m = raw.match(/^(\d{1,2})点半$/);
    if (m) return pad2(+m[1]) + ":30";
    m = raw.match(/^(\d{1,2})点$/);
    if (m) return pad2(+m[1]) + ":00";
    m = raw.match(/^([一二两三四五六七八九十]{1,3})点(?:(半)|(\d{1,2})分?|(多))?$/);
    if (m) {
      const h = CN_NUM[m[1]];
      if (h == null) return raw;
      if (m[2]) return pad2(h) + ":30";
      if (m[3]) return pad2(h) + ":" + pad2(+m[3]);
      return pad2(h) + ":00";
    }
    return raw;
  }

  function round1(v) {
    return Math.round(v * 10) / 10;
  }

  const SNACK_RE = /奶茶|可乐|咖啡|饮料|零食|薯片|饼干|巧克力|酒|蛋糕|甜品|雪糕|冰淇淋|果汁|汽水|酸奶/;
  const MEAL_RE = /早餐|早饭|午餐|午饭|晚餐|晚饭|火锅|烤肉|外卖|食堂|吃了|做饭|聚餐|下馆子|宵夜|夜宵/;
  const WORK_RE = /工作|开会|会议|项目|PPT|ppt|文档|邮件|客户|评审|周报|月报|汇报|出差|方案|代码|需求|例会/;
  const PARENT_RE = /陶陶|孩子|儿子|女儿|娃|作业|上学|放学|接他|接她|陪他|陪她|陪娃|钢琴|画画|兴趣班|幼儿园|亲子|哄睡|给他|给她|家长会/;

  // 追加一行（每句一行），已存在相同行则跳过
  function pushLine(field, line) {
    const lines = field.split("\n").map((s) => s.trim()).filter(Boolean);
    if (lines.indexOf(line) === -1) lines.push(line);
    return lines.join("\n");
  }

  // draft: { sleep:{bedTime,wakeTime}, weight:{night,morning}(kg), diet:{snacks,meals}, work, parenting:{life} }
  // 对已按句拆分后的全部流水账文本做提取；只改 draft，不写页面
  // 注：提取按「子句」切分（句号、问号、分号、逗号、换行都切），保证逗号连接的多个事项各自归属
  function extract(draft, allText) {
    const sentences = String(allText || "")
      .split(/[。！？!?；;，,\n]+/)
      .map((s) => s.trim())
      .filter(Boolean);

    sentences.forEach((s) => {
      // 睡眠（覆盖）
      const timeMatch = s.match(TIME_TOKEN_RE);
      if (timeMatch) {
        const t = normalizeTime(timeMatch[1]);
        if (/睡|入睡|睡下|睡觉/.test(s) && /昨晚|晚上|夜里|睡前|半夜|凌晨/.test(s)) {
          draft.sleep.bedTime = t;
        }
        if (/起床|醒来|睡醒|醒了|醒/.test(s) && /今早|早上|早晨|清晨/.test(s)) {
          draft.sleep.wakeTime = t;
        }
      }

      // 体重（覆盖，存 kg）
      const wMatch = s.match(/(\d+(?:\.\d+)?)\s*(斤|公斤|千克|kg|KG)/);
      if (wMatch) {
        const val = parseFloat(wMatch[1]);
        const u = wMatch[2];
        const kg = u === "斤" ? round1(val / 2) : val;
        if (/睡前|晚上|夜里|昨晚|夜里/.test(s)) {
          draft.weight.night = kg;
        } else {
          // 早起/早上/空腹/晨，或无修饰时默认归早上
          draft.weight.morning = kg;
        }
      }

      // 饮食（追加去重）
      if (SNACK_RE.test(s)) draft.diet.snacks = pushLine(draft.diet.snacks, s);
      if (MEAL_RE.test(s)) draft.diet.meals = pushLine(draft.diet.meals, s);

      // 工作（追加去重）
      if (WORK_RE.test(s)) draft.work = pushLine(draft.work, s);

      // 育儿·生活（追加去重）
      if (PARENT_RE.test(s)) draft.parenting.life = pushLine(draft.parenting.life, s);
    });

    return draft;
  }

  window.Smart = { cleanText: cleanText, segment: segment, organize: organize, extract: extract };
})();
