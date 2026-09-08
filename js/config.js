// 站点配置
// token 不再写死在代码里（避免泄漏进仓库）。改为用户在网页顶部的提示条中输入一次，
// 保存在浏览器 localStorage（key: taoguan_github_token），每个设备只需输入一次。
// token 需要 GitHub fine-grained PAT：仅授权 TaoGuan-Daily-log 仓库、Contents 权限选 Read and write。
// 如需代码级覆盖（不建议），可在此填入；留空则以上述 localStorage 为准。
window.SITE_CONFIG = {
  owner: "vainturerous-Guan",
  repo: "TaoGuan-Daily-log",
  token: "",
};
