function! ddu#start(...) abort
  call ddu#_request('start', [get(a:000, 0, {})])
endfunction
function! ddu#redraw(name, ...) abort
  call ddu#_notify('redraw', [a:name, get(a:000, 0, {})])
endfunction
function! ddu#redraw_tree(name, mode, items) abort
  return ddu#_notify('redrawTree', [a:name, a:mode, a:items])
endfunction
function! ddu#event(name, event) abort
  call ddu#_request('event', [a:name, a:event])
endfunction
function! ddu#pop(name) abort
  call ddu#_request('pop', [a:name])
endfunction
function! ddu#ui_action(name, action, params) abort
  call ddu#_request('uiAction', [a:name, a:action, a:params])
endfunction
function! ddu#item_action(name, action, items, params) abort
  call ddu#_request('itemAction', [a:name, a:action, a:items, a:params])
endfunction
function! ddu#get_item_actions(name, items) abort
  return ddu#_request('getItemActions', [a:name, a:items])
endfunction
function! ddu#get_previewer(name, item, params, context) abort
  return ddu#_request('getPreviewer', [a:name, a:item, a:params, a:context])
endfunction

function! ddu#_request(method, args) abort
  if s:init()
    return {}
  endif

  " Note: If call denops#plugin#wait() in vim_starting, freezed!
  if has('vim_starting')
    call ddu#util#print_error(
          \ 'You cannot call ddu.vim in vim_starting.')
    return {}
  endif

  " You cannot use ddu.vim in the command line window.
  if getcmdwintype() !=# ''
    call ddu#util#print_error(
          \ 'You cannot call ddu.vim in the command line window.')
    return {}
  endif

  if denops#plugin#wait('ddu')
    return {}
  endif
  return denops#request('ddu', a:method, a:args)
endfunction
function! ddu#_notify(method, args) abort
  if s:init()
    return {}
  endif

  if ddu#_denops_running()
    if denops#plugin#wait('ddu')
      return {}
    endif
    call denops#notify('ddu', a:method, a:args)
  else
    " Lazy call notify
    execute printf('autocmd User DDUReady call ' .
          \ 'denops#notify("ddu", "%s", %s)',
          \ a:method, string(a:args))
  endif

  return {}
endfunction

function! s:init() abort
  if exists('g:ddu#_initialized')
    return
  endif

  if !has('patch-8.2.0662') && !has('nvim-0.8')
    call ddu#util#print_error(
          \ 'ddu requires Vim 8.2.0662+ or neovim 0.8.0+.')
    return 1
  endif

  augroup ddu
    autocmd!
    autocmd User DDUReady :
  augroup END

  " Note: ddu.vim must be registered manually.

  " Note: denops load may be started
  autocmd ddu User DenopsReady silent! call ddu#_register()
  if exists('g:loaded_denops') && denops#server#status() ==# 'running'
    silent! call ddu#_register()
  endif
endfunction

let s:root_dir = fnamemodify(expand('<sfile>'), ':h:h')
let s:sep = has('win32') ? '\' : '/'
function! ddu#_register() abort
  call denops#plugin#register('ddu',
        \ join([s:root_dir, 'denops', 'ddu', 'app.ts'], s:sep),
        \ #{ mode: 'skip' })

  autocmd ddu User DenopsClosed call s:stopped()
endfunction

function! s:stopped() abort
  unlet! g:ddu#_initialized

  " Restore custom config
  if exists('g:ddu#_customs')
    for custom in g:ddu#_customs
      call ddu#_notify(custom.method, custom.args)
    endfor
  endif
endfunction

function! ddu#_denops_running() abort
  return exists('g:loaded_denops')
        \ && denops#server#status() ==# 'running'
        \ && denops#plugin#is_loaded('ddu')
endfunction

function! ddu#_lazy_redraw(name, ...) abort
  let args = get(a:000, 0, {})
  call timer_start(0, { -> ddu#redraw(a:name, args) })
endfunction
