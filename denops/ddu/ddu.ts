import { assertEquals, Denops, fn, op, parse, toFileUrl } from "./deps.ts";
import {
  BaseFilter,
  BaseKind,
  BaseSource,
  BaseUi,
  DduItem,
  DduOptions,
  Item,
  SourceOptions,
  UserSource,
} from "./types.ts";
import {
  defaultDduOptions,
  foldMerge,
  mergeSourceOptions,
  mergeSourceParams,
} from "./context.ts";
import { defaultUiOptions, defaultUiParams } from "./base/ui.ts";
import { defaultSourceOptions, defaultSourceParams } from "./base/source.ts";
import { defaultFilterOptions, defaultFilterParams } from "./base/filter.ts";
import { defaultKindOptions, defaultKindParams } from "./base/kind.ts";

export class Ddu {
  private uis: Record<string, BaseUi<Record<string, unknown>>> = {};
  private sources: Record<string, BaseSource<Record<string, unknown>>> = {};
  private filters: Record<string, BaseFilter<Record<string, unknown>>> = {};
  private kinds: Record<string, BaseKind<Record<string, unknown>>> = {};
  private aliasSources: Record<string, string> = {};
  private aliasFilters: Record<string, string> = {};
  private checkPaths: Record<string, boolean> = {};
  private items: DduItem[] = [];
  private options: DduOptions = defaultDduOptions();

  async start(
    denops: Denops,
    options: DduOptions,
  ): Promise<void> {
    await this.autoload(denops, "source", options.sources.map((s) => s.name));

    this.items = [];
    this.options = options;

    for (const userSource of options.sources) {
      const source = this.sources[userSource.name];
      const [sourceOptions, sourceParams] = sourceArgs(
        options,
        userSource,
        source,
      );
      const sourceItems = source.gather({
        denops: denops,
        context: {},
        options: this.options,
        sourceOptions: sourceOptions,
        sourceParams: sourceParams,
        input: "",
      });

      const reader = sourceItems.getReader();

      const readChunk = async (
        v: ReadableStreamReadResult<Item<unknown>[]>,
      ) => {
        if (!v.value || v.done) {
          return;
        }

        const newItems = v.value.map((item: Item) => {
          const matcherKey = (sourceOptions.matcherKey in item)
            ? (item as Record<string, string>)[sourceOptions.matcherKey]
            : item.word;
          return {
            ...item,
            matcherKey: matcherKey,
            __sourceName: source.name,
          };
        });

        this.items = this.items.concat(newItems);

        await this.narrow(denops, this.options.input);

        reader.read().then(readChunk);
      };

      reader.read().then(readChunk);
    }
  }

  async narrow(
    denops: Denops,
    input: string,
  ): Promise<void> {
    await this.autoload(denops, "filter", ["matcher_substring"]);

    const filteredItems = await this.filters["matcher_substring"].filter({
      denops: denops,
      context: {},
      options: this.options,
      sourceOptions: defaultSourceOptions(),
      filterOptions: defaultFilterOptions(),
      filterParams: defaultFilterParams(),
      input: input,
      items: this.items,
    });

    await this.autoload(denops, "ui", [this.options.ui]);
    if (!this.uis[this.options.ui]) {
      await denops.call(
        "ddu#util#print_error",
        `Invalid ui is detected: "${this.options.ui}"`,
      );
      return;
    }

    await this.uis[this.options.ui].redraw({
      denops: denops,
      options: this.options,
      uiOptions: defaultUiOptions(),
      uiParams: defaultUiParams(),
      items: filteredItems,
    });
  }

  async uiAction(
    denops: Denops,
    actionName: string,
    params: unknown,
  ): Promise<void> {
    await this.autoload(denops, "ui", [this.options.ui]);
    if (!this.uis[this.options.ui]) {
      await denops.call(
        "ddu#util#print_error",
        `Invalid ui is detected: "${this.options.ui}"`,
      );
      return;
    }

    const action = this.uis[this.options.ui].actions[actionName];
    await action({
      denops: denops,
      context: {},
      options: defaultDduOptions(),
      uiOptions: defaultUiOptions(),
      uiParams: defaultUiParams(),
      actionParams: params,
    });
  }

  async doAction(
    denops: Denops,
    actionName: string,
    items: DduItem[],
    params: unknown,
  ): Promise<void> {
    if (actionName == "default") {
      // Use default action
      actionName = "open";
    }

    const kinds = [
      ...new Set(items.map((item) => this.sources[item.__sourceName].kind)),
    ];
    if (kinds.length != 1) {
      await denops.call(
        "ddu#util#print_error",
        `You must not mix multiple kinds: "${kinds}"`,
      );
      return;
    }

    await this.autoload(denops, "kind", kinds);

    const action = this.kinds[kinds[0]].actions[actionName];
    await action({
      denops: denops,
      context: {},
      options: defaultDduOptions(),
      kindOptions: defaultKindOptions(),
      kindParams: defaultKindParams(),
      actionParams: params,
      items: items,
    });
  }

  async registerUI(path: string, name: string) {
    this.checkPaths[path] = true;

    const mod = await import(toFileUrl(path).href);

    const addUI = (name: string) => {
      const ui = new mod.Ui();
      ui.name = name;
      this.uis[ui.name] = ui;
    };

    addUI(name);
  }

  async registerSource(path: string, name: string) {
    this.checkPaths[path] = true;

    const mod = await import(toFileUrl(path).href);

    const addSource = (name: string) => {
      const source = new mod.Source();
      source.name = name;
      this.sources[source.name] = source;
    };

    addSource(name);

    // Check alias
    const aliases = Object.keys(this.aliasSources).filter(
      (k) => this.aliasSources[k] == name,
    );
    for (const alias of aliases) {
      addSource(alias);
    }
  }

  async registerFilter(path: string, name: string) {
    this.checkPaths[path] = true;

    const mod = await import(toFileUrl(path).href);

    const addFilter = (name: string) => {
      const filter = new mod.Filter();
      filter.name = name;
      this.filters[filter.name] = filter;
    };

    addFilter(name);

    // Check alias
    const aliases = Object.keys(this.aliasFilters).filter(
      (k) => this.aliasFilters[k] == name,
    );
    for (const alias of aliases) {
      addFilter(alias);
    }
  }

  async registerKind(path: string, name: string) {
    this.checkPaths[path] = true;

    const mod = await import(toFileUrl(path).href);

    const addKind = (name: string) => {
      const kind = new mod.Kind();
      kind.name = name;
      this.kinds[kind.name] = kind;
    };

    addKind(name);
  }

  async autoload(
    denops: Denops,
    type: "ui" | "source" | "filter" | "kind",
    names: string[],
  ): Promise<string[]> {
    if (names.length == 0) {
      return Promise.resolve([]);
    }

    const runtimepath = await op.runtimepath.getGlobal(denops);

    async function globpath(
      searches: string[],
      files: string[],
    ): Promise<string[]> {
      let paths: string[] = [];
      for (const search of searches) {
        for (const file of files) {
          paths = paths.concat(
            await fn.globpath(
              denops,
              runtimepath,
              search + file + ".ts",
              1,
              1,
            ) as string[],
          );
        }
      }

      return Promise.resolve(paths);
    }

    if (type == "ui") {
      const paths = (await globpath(
        ["denops/@ddu-uis/"],
        names,
      )).filter((path) => !(path in this.checkPaths));

      await Promise.all(paths.map(async (path) => {
        await this.registerUI(path, parse(path).name);
      }));

      return Promise.resolve(paths);
    } else if (type == "source") {
      const paths = (await globpath(
        ["denops/@ddu-sources/"],
        names.map((file) => this.aliasSources[file] ?? file),
      )).filter((path) => !(path in this.checkPaths));

      await Promise.all(paths.map(async (path) => {
        await this.registerSource(path, parse(path).name);
      }));

      return Promise.resolve(paths);
    } else if (type == "filter") {
      const paths = (await globpath(
        ["denops/@ddu-filters/"],
        names.map((file) => this.aliasFilters[file] ?? file),
      )).filter((path) => !(path in this.checkPaths));

      await Promise.all(paths.map(async (path) => {
        await this.registerFilter(path, parse(path).name);
      }));

      return Promise.resolve(paths);
    } else if (type == "kind") {
      const paths = (await globpath(
        ["denops/@ddu-kinds/"],
        names,
      )).filter((path) => !(path in this.checkPaths));

      await Promise.all(paths.map(async (path) => {
        await this.registerKind(path, parse(path).name);
      }));

      return Promise.resolve(paths);
    }

    return Promise.resolve([]);
  }
}

function sourceArgs<
  Params extends Record<string, unknown>,
  UserData extends unknown,
>(
  options: DduOptions,
  userSource: UserSource,
  source: BaseSource<Params, UserData>,
): [SourceOptions, Record<string, unknown>] {
  const o = foldMerge(
    mergeSourceOptions,
    defaultSourceOptions,
    [
      options.sourceOptions["_"],
      options.sourceOptions[source.name],
      userSource.options,
    ],
  );
  const p = foldMerge(mergeSourceParams, defaultSourceParams, [
    source.params ? source.params() : null,
    options.sourceParams[source.name],
    userSource.params,
  ]);
  return [o, p];
}

Deno.test("test", () => {
  assertEquals(1, 1);
});
