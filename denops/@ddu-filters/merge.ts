import { toFileUrl } from "https://deno.land/std@0.171.0/path/mod.ts";
import { type Denops } from "https://deno.land/x/denops_std@v4.0.0/mod.ts";
import {
  BaseFilter,
  type DduItem,
  DduOptions,
  type FilterOptions,
} from "https://deno.land/x/ddu_vim@v2.2.0/types.ts";
import {
  type FilterArguments,
  type OnInitArguments,
} from "https://deno.land/x/ddu_vim@v2.2.0/base/filter.ts";
import * as fn from "https://deno.land/x/denops_std@v4.0.0/function/mod.ts";
import * as op from "https://deno.land/x/denops_std@v4.0.0/option/mod.ts";
import {
  assertArray,
  AssertError,
  assertObject,
  ensureBoolean,
  ensureNumber,
  isString,
} from "https://deno.land/x/unknownutil@v2.1.0/mod.ts";

type FilterClass = BaseFilter<Record<string, unknown>>;

type FilterModule = {
  Filter: { new (): FilterClass };
};

type FilterParams = Record<string, unknown>;

type GetFilterResult = [
  FilterClass | undefined,
  FilterOptions,
  FilterParams,
];

type FilterName = string;

type ChildFilter = {
  name: FilterName;
  limit?: number;
  weight?: number;
};

type Params = {
  filters: (ChildFilter | FilterName)[];
  unique: boolean;
};

type NormalizeParams = {
  filters: Required<ChildFilter>[];
  unique: boolean;
};

type ScoreItem = {
  /** Lower scores are sorted earlier (ascending order). */
  score: number;
  item: DduItem;
};

export class Filter extends BaseFilter<Params> {
  #filters: Map<string, FilterClass> = new Map();

  override params(): Params {
    return {
      filters: [],
      unique: true,
    };
  }

  override async onInit(args: OnInitArguments<Params>): Promise<void> {
    const { denops, filterParams } = args;
    const { filters } = ensureFilterParams(filterParams);
    await this.#loadFilters(denops, filters);
  }

  override async filter(args: FilterArguments<Params>): Promise<DduItem[]> {
    let { items } = args;
    const { denops, input, options, sourceOptions, filterParams } = args;

    const { filters } = ensureFilterParams(filterParams);
    await this.#loadFilters(denops, filters);

    const availFilters = (await Promise.all(filters.map(async (param) => {
      const [filter, filterOptions, filterParams] = await this.#getFilter(
        denops,
        param.name,
        options,
      );
      return filter ? { param, filter, filterOptions, filterParams } : null;
    }))).filter(nonNullable);

    if (availFilters.length === 0) {
      return items;
    }

    const merged = (await Promise.all(
      availFilters.map(
        async ({ param, filter, filterOptions, filterParams }) => {
          let subItems = await filter.filter({
            denops,
            input,
            // NOTE: Shallow copy each items.
            items: items.map((item) => ({ ...item })),
            options,
            sourceOptions,
            filterOptions,
            filterParams,
          });
          if (param.limit > 0) {
            subItems = subItems.slice(0, param.limit);
          }
          const invWeight = 1.0 / param.weight;
          return subItems.map((item, index): ScoreItem => ({
            score: index * invWeight,
            item,
          }));
        },
      ),
    )).flat();

    const sorted = merged.sort((a, b) => a.score - b.score);
    items = sorted.map(({ item }) => item);

    if (filterParams.unique) {
      items = Array.from(
        new Map(items.map((item) => [toItemHash(item), item])).values(),
      );
    }

    return items;
  }

  async #loadFilters(denops: Denops, filters: ChildFilter[]): Promise<void> {
    const notLoaded = new Set(
      filters.map(({ name }) => name).filter((name) =>
        !this.#filters.has(name)
      ),
    );
    if (notLoaded.size === 0) return;

    const runtimepath = await op.runtimepath.getGlobal(denops);
    await Promise.all(
      Array.from(notLoaded).map(async (name) => {
        const expr = `denops/@ddu-filters/${name}.ts`;
        const glob = await fn.globpath(
          denops,
          runtimepath,
          expr,
          /* NOSUF */ 1,
          /* LIST */ 1,
        ) as string[];
        const path = glob.at(0);
        if (path) {
          const mod = await import(toFileUrl(path).href) as FilterModule;
          const filter = new mod.Filter();
          filter.name = name;
          this.#filters.set(name, filter);
        }
      }),
    );
  }

  async #getFilter(
    denops: Denops,
    name: string,
    options: DduOptions,
  ): Promise<GetFilterResult> {
    const filter = this.#filters.get(name);
    if (!filter) {
      logError(`Invalid filter: ${name}`);
      return [undefined, {}, {}];
    }

    const [_, filterOptions, filterParams] = await denops.dispatch(
      "ddu",
      "getFilter",
      options.name,
      name,
    ) as GetFilterResult;

    if (!filter.isInitialized) {
      try {
        await filter.onInit({ denops, filterOptions, filterParams });
      } catch (e: unknown) {
        logError(e);
        return [undefined, {}, {}];
      }
      filter.isInitialized = true;
    }

    return [filter, filterOptions, filterParams];
  }
}

function logError(msg: unknown): void {
  console.error("ddu-filter-merge:", msg);
}

function ensureFilterParams(params: Params): NormalizeParams {
  assertArray(params.filters);
  const filters = params.filters.map((p): Required<ChildFilter> => {
    if (isString(p)) {
      p = { name: p };
    } else {
      assertObject(p);
    }
    const limit = ensureNumber(p.limit ?? 0);
    const weight = ensureNumber(p.weight ?? 1.0);
    if (weight <= 0) {
      throw new AssertError(
        `Invalid parameter: 'weight' must be greater than 0, but ${weight}`,
      );
    }
    return { name: p.name, limit, weight };
  });
  return {
    filters,
    unique: ensureBoolean(params.unique),
  };
}

function toItemHash(item: DduItem): string {
  return [item.kind, item.level, item.word, item.display].join("\0");
}

function nonNullable<T>(value: T): value is NonNullable<T> {
  return value != null;
}
