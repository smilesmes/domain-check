// src/cron.js

import { getConfig, sendtgMessage } from './utils';
import { getDomainsFromKV } from './api/domains';

export async function getDomainsList(env) {
    try {
        return await getDomainsFromKV(env);
    } catch (e) {
        console.error('从 KV 获取域名列表失败:', e.message);
        return [];
    }
}

export async function checkDomainsScheduled(env, options = {}) {
    const config = getConfig(env);
    const allDomains = await getDomainsList(env);
    const expiringDomains = [];

    if (allDomains.length === 0) {
        console.log("KV中没有域名数据，跳过定时检查");
        return expiringDomains;
    }

    const now = new Date();
    const todayUTC = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());

    for (const domainInfo of allDomains) {
        // 分组过滤
        if (options.group) {
            const domainGroups = (domainInfo.groups || '').split(',').map(g => g.trim());
            const targetGroups = options.group.split(',').map(g => g.trim());
            const hasMatch = targetGroups.some(tg => domainGroups.includes(tg));
            if (!hasMatch) continue;
        }

        // 域名过滤
        if (options.domain && domainInfo.domain !== options.domain) continue;

        // 确定该域名的提醒阈值：
        // 1. 手动指定 domain/group 时 → 忽略阈值，强制提醒
        // 2. 域名自身有 alertDays 字段 → 用 alertDays
        // 3. 否则 → 用全局 DAYS
        const isManual = !!(options.domain || options.group);
        let maxDaysForAlert;
        if (isManual) {
            maxDaysForAlert = Infinity;
        } else if (domainInfo.alertDays !== undefined && domainInfo.alertDays !== null && domainInfo.alertDays >= 0) {
            maxDaysForAlert = domainInfo.alertDays;
        } else {
            maxDaysForAlert = config.days;
        }

        const expirationUTC = Date.parse(domainInfo.expirationDate);
        if (isNaN(expirationUTC)) {
            console.warn(`跳过无效日期 (${domainInfo.domain}): ${domainInfo.expirationDate}`);
            continue;
        }
        const timeDiff = expirationUTC - todayUTC;
        const daysRemaining = Math.ceil(timeDiff / (1000 * 60 * 60 * 24));

        if (daysRemaining > 0 && daysRemaining <= maxDaysForAlert) {
            const message = `
<b>🚨 域名到期提醒 🚨</b>
====================
🌐 域名: <code>${domainInfo.domain}</code>
♻️ 将在 <b>${daysRemaining}天</b> 后过期！
📅 过期日期: ${domainInfo.expirationDate}
🔗 注册商: <a href="${domainInfo.systemURL}">${domainInfo.system}</a>
👤 注册账号: <code>${domainInfo.registerAccount || 'N/A'}</code>
--------------------------`;

            await sendtgMessage(message, config.tgid, config.tgtoken);
            console.log(`已发送 ${domainInfo.domain} 的到期通知.`);
            expiringDomains.push({
                domain: domainInfo.domain,
                expirationDate: domainInfo.expirationDate,
                daysRemaining: daysRemaining,
                system: domainInfo.system,
                systemURL: domainInfo.systemURL,
                registerAccount: domainInfo.registerAccount || 'N/A',
                groups: domainInfo.groups || 'N/A'
            });
        }
    }
    return expiringDomains;
}
