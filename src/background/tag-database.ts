import emojiRegex from 'emoji-regex';
import pako from 'pako';
import { BehaviorSubject } from 'rxjs';
import { browser } from 'webextension-polyfill-ts';

import { EHTDatabase, TagList, TagReplace } from '../interface';
import { chromeMessage } from '../tool/chrome-message';
import { logger } from '../tool/log';
import { getFullKey, getSearchTerm } from '../tool/tool';

const emojiReg = emojiRegex();
const defaultReleaseLink = 'https://github.com/EhTagTranslation/EhSyringe/blob/master/src/assets/tag.db';
/* 数据存储结构版本, 如果不同 系统会自动执行 storageTagData 重新构建数据*/
/* 注意这是本地数据结构, 主要用于 storageTagData内解析方法发生变化, 重新加载数据的, 与线上无关*/
const DATA_STRUCTURE_VERSION = 6;

class TagDatabase {
    readonly tagList = new BehaviorSubject<TagList>([]);
    readonly tagReplace = new BehaviorSubject<TagReplace>({});
    readonly updateTime = new BehaviorSubject<Date | undefined>(undefined);
    readonly releaseLink = new BehaviorSubject<string>(defaultReleaseLink);
    readonly sha = new BehaviorSubject<string>('');

    constructor() {
        chromeMessage.listener('get-taglist', (key) => {
            if (!key) {
                return this.tagList.value;
            }
            return this.tagList.value.find((t) => t.fullKey === key);
        });
        chromeMessage.listener('get-tagreplace', (key) => {
            if (!key) {
                return this.tagReplace.value;
            }
            return this.tagReplace.value[key];
        });
        this.init().catch(logger.error);
    }

    private async init(): Promise<void> {
        const {
            tagList,
            tagReplace,
            releaseLink,
            sha,
            updateTime,
            dataStructureVersion,
        } = await browser.storage.local.get([
            'tagList',
            'tagReplace',
            'releaseLink',
            'updateTime',
            'sha',
            'dataStructureVersion',
        ]);
        if (dataStructureVersion !== DATA_STRUCTURE_VERSION || !tagList || !tagReplace || !releaseLink || !sha) {
            const timer = logger.time('数据结构变化, 重新构建数据');
            await this.updateUseLocal();
            timer.end();
        } else {
            this.tagList.next(tagList);
            this.tagReplace.next(tagReplace);
            this.updateTime.next(new Date(updateTime));
            this.sha.next(sha);
            this.releaseLink.next(releaseLink);
        }
    }

    async updateUseLocal(): Promise<void> {
        const dbUrl = chrome.runtime.getURL('assets/tag.db');
        const r = await fetch(dbUrl);
        const buf = await r.arrayBuffer();
        this.update(buf, true, defaultReleaseLink, new Date(0));
    }

    update(data: ArrayBuffer, isGziped: boolean, releaseLink: string, updateTime: Date = new Date()): void {
        const timer = logger.time('构建数据');
        const tagDB: EHTDatabase = JSON.parse(
            isGziped ? pako.ungzip(new Uint8Array(data), { to: 'string' }) : new TextDecoder('utf-8').decode(data),
        );
        const sha = tagDB.head.sha;
        const tagReplace: TagReplace = {};
        const tagList: TagList = [];
        tagDB.data.forEach((space) => {
            const namespace = space.namespace;
            if (namespace === 'rows') return;
            for (const key in space.data) {
                const t = space.data[key];

                const name = t.name.replace(/^<p>(.+?)<\/p>$/, '$1').trim();
                const cleanName = name
                    .replace(emojiReg, '')
                    .replace(/<img.*?>/gi, '')
                    .trim();
                const dirtyName = name
                    .replace(emojiReg, '<span class="ehs-emoji">$&</span>')
                    .replace(/<img(.*?)>/gi, '<img class="ehs-icon" $1>');
                const search = getSearchTerm(namespace, key);
                const fullKey = getFullKey(namespace, key);

                tagList.push({
                    ...t,
                    name: cleanName,
                    key,
                    fullKey,
                    namespace,
                    search,
                });
                tagReplace[fullKey] = dirtyName;
            }
        });
        this.updateTime.next(updateTime.getTime() ? updateTime : undefined);
        this.tagList.next(tagList);
        this.tagReplace.next(tagReplace);
        this.sha.next(sha);
        this.releaseLink.next(releaseLink);
        timer.end();

        // 后台继续处理，直接返回
        browser.storage.local
            .set({
                tagList,
                tagReplace,
                releaseLink,
                sha,
                updateTime: updateTime.getTime() ?? undefined,
                dataStructureVersion: DATA_STRUCTURE_VERSION,
            })
            .catch(logger.error);
    }
}

export const tagDatabase = new TagDatabase();
