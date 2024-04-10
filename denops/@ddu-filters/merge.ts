import { toFileUrl } from "https://deno.land/std@0.221.0/path/mod.ts";
import { type Denops } from "https://deno.land/x/denops_std@v6.4.0/mod.ts";
import type {
  DduFilterItems,
  DduItem,
  DduOptions,
  FilterOptions,
} from "https://deno.land/x/ddu_vim@v3.10.3/types.ts";
import {
  BaseFilter,
  type FilterArguments,
} from "https://deno.land/x/ddu_vim@v3.10.3/base/filter.ts";
import {
  assert,
  AssertError,
  ensure,
  is,
} from "https://deno.land/x/unknownutil@v3.17.2/mod.ts";

type FilterClass = BaseFilter<Record<string, unknown>>;

type FilterModule = {
  Filter: { new (): FilterClass };
};

type FilterParams = Record<string, unknown>;

type DduGetFilterResult = [
  string,
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

  override async filter(
    args: FilterArguments<Params>,
  ): Promise<DduFilterItems> {
    const {
      denops,
      items,
      options,
      sourceOptions,
      filterOptions: _,
      filterParams,
      ...restArgs
    } = args;

    const { filters } = ensureFilterParams(filterParams);

    const availFilters = (await Promise.all(filters.map(async (param) => {
      const { filter, filterOptions, filterParams } = await this.#getFilter(
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
          const filterItems = await filter.filter({
            ...restArgs,
            denops,
            // NOTE: Shallow copy each items.
            items: items.map((item) => ({ ...item })),
            options,
            sourceOptions,
            filterOptions,
            filterParams,
          });

          // NOTE: drop optional parameters of DduFilterItems
          let subItems = Array.isArray(filterItems)
            ? filterItems
            : filterItems.items;

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

    const result = filterParams.unique
      ? Array.from(
        new Map(sorted.map(({ item }) => [toItemHash(item), item])).values(),
      )
      : sorted.map(({ item }) => item);

    return result;
  }

  async #loadFilter(name: string, path: string): Promise<FilterClass> {
    let filter = this.#filters.get(name);
    if (!filter) {
      const mod = await import(toFileUrl(path).href) as FilterModule;
      filter = new mod.Filter();
      filter.name = name;
      this.#filters.set(name, filter);
    }
    return filter;
  }

  async #getFilter(
    denops: Denops,
    name: string,
    options: DduOptions,
  ): Promise<{
    filter: FilterClass | undefined;
    filterOptions: FilterOptions;
    filterParams: FilterParams;
  }> {
    const [path, filterOptions, filterParams] = await dduGetFilter(
      denops,
      options.name,
      name,
    );

    if (!path) {
      logError(`Invalid filter: ${name}`);
      return { filter: undefined, filterOptions, filterParams };
    }

    const filter = await this.#loadFilter(name, path);

    if (!filter.isInitialized) {
      try {
        await filter.onInit({ denops, filterOptions, filterParams });
      } catch (e: unknown) {
        logError(e);
        return { filter: undefined, filterOptions, filterParams };
      }
      filter.isInitialized = true;
    }

    return { filter, filterOptions, filterParams };
  }
}

function logError(msg: unknown): void {
  console.error("ddu-filter-merge:", msg);
}

function ensureFilterParams(params: Params): NormalizeParams {
  assert(params.filters, is.Array);
  const filters = params.filters.map((p): Required<ChildFilter> => {
    if (is.String(p)) {
      p = { name: p };
    } else {
      assert(p, is.Record);
    }
    const limit = ensure(p.limit ?? 0, is.Number);
    const weight = ensure(p.weight ?? 1.0, is.Number);
    if (weight <= 0) {
      throw new AssertError(
        `Invalid parameter: 'weight' must be greater than 0, but ${weight}`,
      );
    }
    return { name: p.name, limit, weight };
  });
  const unique = ensure(params.unique, is.Boolean);
  return { filters, unique };
}

function toItemHash(item: DduItem): string {
  return [item.kind, item.level, item.word, item.display].join("\0");
}

function nonNullable<T>(value: T): value is NonNullable<T> {
  return value != null;
}

function dduGetFilter(
  denops: Denops,
  dduName: string,
  filterName: string,
): Promise<DduGetFilterResult> {
  return denops.dispatch(
    "ddu",
    "getFilter",
    dduName,
    filterName,
  ) as Promise<DduGetFilterResult>;
}
