import type {MarkdownIt, OptionsType, EnvType} from './typings';
import type {MarkdownItPluginProcessor} from './plugins/typings';
import type Token from 'markdown-it/lib/token';

import DefaultMarkdownIt from 'markdown-it';
import DefaultPlugins from './plugins';
import {log} from './log';
import makeHighlight from './highlight';
import attrs from 'markdown-it-attrs';
import extractTitle from './title';
import getHeadings from './headings';
import sanitizeHtml from './sanitize';

function initMarkdownit(options: OptionsType) {
    const {allowHTML = false, linkify = false, breaks = true, highlightLangs = {}} = options;

    const highlight = makeHighlight(highlightLangs);
    const md = new DefaultMarkdownIt({html: allowHTML, linkify, highlight, breaks}) as MarkdownIt;
    const env = {
        // TODO: move md.meta directly to env
        get meta() {
            return md.meta;
        },
        // TODO: move md.assets directly to env
        get assets() {
            return md.assets;
        },
        headings: [],
        title: '',
    } as EnvType;

    initPlugins(md, options);

    const parse = initParser(md, options, env);
    const process = initProcessor(md, options, env);
    const compile = initCompiler(md, options, env);

    return {parse, process, compile, env};
}

function initPlugins(md: MarkdownIt, options: OptionsType) {
    const {
        vars = {},
        path,
        extractTitle,
        conditionsInCode = false,
        disableLiquid = false,
        linkify = false,
        linkifyTlds,
        leftDelimiter = '{',
        rightDelimiter = '}',
        plugins = DefaultPlugins,
        ...customOptions
    } = options;

    const pluginOptions = {
        ...customOptions,
        conditionsInCode,
        vars,
        path,
        extractTitle,
        disableLiquid,
        log,
    };

    // Need for ids of headers
    md.use(attrs, {leftDelimiter, rightDelimiter});

    plugins.forEach((plugin) => md.use(plugin, pluginOptions));

    if (linkify && linkifyTlds) {
        md.linkify.tlds(linkifyTlds, true);
    }
}

function initParser(md: MarkdownIt, options: OptionsType, env: EnvType) {
    return (input: string) => {
        const {extractTitle: extractTitleOption, needTitle, needFlatListHeadings = false} = options;

        let tokens = md.parse(input, env);

        if (extractTitleOption) {
            const {title, tokens: slicedTokens, titleTokens} = extractTitle(tokens);

            tokens = slicedTokens;

            // title tokens include other tokens that need to be transformed
            if (titleTokens.length > 1) {
                env.title = md.renderer.render(titleTokens, md.options, env);
            } else {
                env.title = title;
            }
        }

        if (needTitle) {
            env.title = extractTitle(tokens).title;
        }

        env.headings = getHeadings(tokens, needFlatListHeadings);

        return tokens;
    };
}

function initProcessor(md: MarkdownIt, options: OptionsType, env: EnvType) {
    const {plugins = DefaultPlugins} = options;
    const processors = plugins
        .filter((plugin) => typeof plugin.process === 'function')
        .map((plugin) => plugin.process);

    return async (tokens: Token[]): Promise<Token[]> => {
        while (processors.length) {
            const processor = processors.shift() as MarkdownItPluginProcessor;

            tokens = await processor(tokens, md, env);
        }

        return tokens;
    };
}

function initCompiler(md: MarkdownIt, options: OptionsType, env: EnvType<{termTokens?: Token[]}>) {
    const {needToSanitizeHtml = false, sanitizeOptions} = options;

    return (tokens: Token[]) => {
        // TODO: define postprocess step on term plugin
        const {termTokens = []} = env;
        delete env.termTokens;

        const html = md.renderer.render([...tokens, ...termTokens], md.options, env);

        return needToSanitizeHtml ? sanitizeHtml(html, sanitizeOptions) : html;
    };
}

export = initMarkdownit;
