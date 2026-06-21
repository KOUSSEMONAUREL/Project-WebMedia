import * as cheerio from 'cheerio';

export const parseHtml = (html: string) => {
    return cheerio.load(html);
};
