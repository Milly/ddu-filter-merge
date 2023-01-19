# ddu-filter-merge

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square)](LICENSE)
[![Vim doc](https://img.shields.io/badge/doc-%3Ah%20ddu--filter--merge-orange.svg?style=flat-square&logo=vim)](doc/ddu-filter-merge.txt)

Merge output items from multiple filters for ddu.vim.

## Required

It depends on the following plugins.

- [denops.vim][]
- [ddu.vim][]
- Your favorite [ddu-filter][] plugins.

## Installation

1. Install [Deno][].
2. Install plugins using [vim-plug][] etc.

```
Plug 'vim-denops/denops.vim'
Plug 'Shougo/ddu.vim'
Plug 'Milly/ddu-filter-merge'

" And your favorite ddu-filter plugins
Plug 'Milly/ddu-filter-kensaku'
Plug 'kuuote/ddu-filter-fuse'
```

## Configuration

Configure ddu.vim.

```vim
call ddu#custom#patch_global('sourceOptions', #{
      \  _: #{
      \    matchers: ['merge'],
      \  },
      \})

call ddu#custom#patch_global('filterParams', #{
      \  merge: #{
      \    filters: [
      \      #{name: 'matcher_kensaku', weight: 2.0},
      \      'matcher_fuse',
      \    ],
      \    unique: v:true,
      \  },
      \})
```

[Deno]: https://deno.land/
[ddu-filter]: https://github.com/topics/ddu-filter
[ddu.vim]: https://github.com/Shougo/ddu.vim
[denops.vim]: https://github.com/vim-denops/denops.vim
[vim-plug]: https://github.com/junegunn/vim-plug
