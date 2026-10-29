// Editable menu runtime
(function () {
    if (window.EDITABLE_MENU_ENABLED !== true) {
        return;
    }

    var MENU_ALLOWED_IDS = [
        'switch_hist_menu', 'switch_dashboard', 'switch_explore_menu', 'switch_deals_menu', 'switch_best_menu',
        'switch_tasks_menu', 'switch_mini_tools_menu', 'switch_characters_menu', 'switch_events_menu',
        'switch_ebook_menu', 'divider_1', 'switch_featured_menu', 'switch_subscribe_menu',
        'switch_merch_menu', 'switch_contact_menu', 'divider_2', 'switch_create_tool_menu', 'divider_3',
    ];
    var MENU_MAX_ORDERED_ITEMS = 200;
    var menu_sortable = null;
    var menu_sortable_loading = false;
    var edit_chrome_pull = 0;
    var edit_chrome_hide_timer = null;
    var edit_chrome_wheel_bound = false;
    var pin_reveal_timer = null;
    var pin_reveal_token = 0;
    var menu_layout_ready = false;
    var menu_layout_sync_started = false;
    var menu_layout_authoritative = false;
    var menu_layout_sync_callbacks = [];
    var lazy_menu_sync_scheduled = false;
    var menu_layout_revision = 0;
    var confirmed_menu_layout = null;
    var menu_mutation_in_flight = null;
    var queued_menu_mutation = null;
    var menu_mutation_flush_callbacks = [];
    var menu_notice_timer = null;
    var pin_button_settle_cleanup = null;

    document.addEventListener('click', function (e) {
        var menu = editable_menu_root();
        if (!menu || !menu.classList.contains('edit_menu')) {
            return;
        }
        var interactiveControl = e.target.closest(
            '.menu_item_drag_handle, .menu_item_hide_toggle, .menu_item_remove, ' +
            '#menu_edit_toggle, #menu_edit_done, #menu_edit_reset, #menu_add_divider'
        );
        if (interactiveControl) {
            e.preventDefault();
            return;
        }
        if (e.target.closest('#menu.menu_pins [data-menu-item="true"]')) {
            e.preventDefault();
            e.stopPropagation();
        }
    }, true);

    function api_path_with_debug(path) {
        var debugQuery = String(window.DEBUG_PARAMS || '').replace(/^[?&]+/, '');
        return path + (debugQuery ? '?' + debugQuery : '');
    }

    // Only the main editable sidebar (#menu.menu_pins). Never treat
    // #menu.dashboard_menu (dashboard / characters sidebars) as editable.
    function editable_menu_root() {
        var menu = by_id('menu');
        return (menu && menu.classList.contains('menu_pins')) ? menu : null;
    }

    function is_editable_sidebar_menu() {
        return !!editable_menu_root();
    }

    function menu_inner_el() {
        var menu = editable_menu_root();
        return menu ? menu.querySelector('.menu_inner') : null;
    }

    function menu_layout_user_id() {
        // Prefer live client identity (localStorage USER). Page cache can bake a
        // different MENU_LAYOUT_USER_ID into HTML from whoever warmed the cache.
        var fromUser = window.USER ? parseInt(window.USER.id, 10) : 0;
        if (fromUser > 0) {
            return fromUser;
        }
        var userId = parseInt(window.MENU_LAYOUT_USER_ID, 10);
        return userId > 0 ? userId : 0;
    }

    function menu_storage_key() {
        if (typeof window.menu_layout_storage_key !== 'function') {
            return '';
        }
        return window.menu_layout_storage_key(menu_layout_user_id());
    }

    function clone_menu_layout(layout) {
        return layout === null ? null : JSON.parse(JSON.stringify(layout));
    }

    function is_valid_menu_layout(layout) {
        return !!layout
            && typeof layout === 'object'
            && !Array.isArray(layout)
            && Array.isArray(layout.order)
            && Array.isArray(layout.hidden)
            && (
                typeof layout.custom_items === 'undefined'
                || (
                    layout.custom_items
                    && typeof layout.custom_items === 'object'
                    && !Array.isArray(layout.custom_items)
                )
            );
    }

    function stored_menu_state() {
        try {
            localStorage.removeItem('menu_layout');
            var storageKey = menu_storage_key();
            if (!storageKey) {
                return null;
            }
            var raw = localStorage.getItem(storageKey);
            if (!raw) {
                return null;
            }
            var envelope = JSON.parse(raw);
            if (
                !envelope
                || !Number.isInteger(envelope.revision)
                || envelope.revision < 0
                || (
                    envelope.layout !== null
                    && !is_valid_menu_layout(envelope.layout)
                )
            ) {
                localStorage.removeItem(storageKey);
                return null;
            }
            var stored_layout = clone_menu_layout(envelope.layout);
            // Heal the persisted [switch_dashboard, custom_…] artifact once, so the
            // next load's raw applies (menu.php / script-head) paint the corrected
            // order instead of the dashboard-on-top flash the observer repair fixes.
            if (dashboard_parked_above_custom(stored_layout)) {
                fix_dashboard_leading_order(stored_layout);
                persist_local_layout(envelope.revision, stored_layout);
            }
            return {
                revision: envelope.revision,
                layout: stored_layout,
            };
        } catch (e) {
            console.log('[editable menu] invalid stored menu layout:', e);
            return null;
        }
    }

    var cached_menu_state = stored_menu_state();
    if (cached_menu_state) {
        menu_layout_revision = cached_menu_state.revision;
        confirmed_menu_layout = clone_menu_layout(cached_menu_state.layout);
    }

    function active_menu_layout() {
        if (queued_menu_mutation) {
            return queued_menu_mutation.layout;
        }
        if (menu_mutation_in_flight) {
            return menu_mutation_in_flight.layout;
        }
        return confirmed_menu_layout;
    }

    function stored_custom_items() {
        var layout = active_menu_layout();
        return layout && layout.custom_items ? layout.custom_items : {};
    }

    // Canonical slot for Dashboard: right after Home, else just before Explore,
    // else the end. Pure (no DOM) so it can be reused when repairing a stored
    // layout before the menu is built.
    function dashboard_order_insert_index(order) {
        var homeIndex = order.indexOf('switch_hist_menu');
        if (homeIndex !== -1) {
            return homeIndex + 1;
        }
        var exploreIndex = order.indexOf('switch_explore_menu');
        if (exploreIndex !== -1) {
            return exploreIndex;
        }
        return order.length;
    }

    // Older ensure_dashboard_in_order spliced at 0 when Home was absent, which
    // persisted [switch_dashboard, custom_…, …] — Dashboard parked above pins.
    function dashboard_parked_above_custom(layout) {
        return !!layout
            && Array.isArray(layout.order)
            && layout.order[0] === 'switch_dashboard'
            && layout.order.length >= 2
            && String(layout.order[1]).indexOf('custom_') === 0;
    }

    function ensure_dashboard_in_order(layout) {
        if (!layout || !layout.order) {
            return layout;
        }
        var menu = editable_menu_root();
        var dashboard = menu ? menu.querySelector('[data-menu-id="switch_dashboard"]') : null;
        if (!dashboard || layout.order.indexOf('switch_dashboard') !== -1) {
            return layout;
        }
        // Never splice at 0 — that parked Dashboard above custom pins whenever
        // Home was missing from a partial saved order (common after late inject).
        layout.order.splice(dashboard_order_insert_index(layout.order), 0, 'switch_dashboard');
        layout.hidden = layout.hidden || [];
        // Fresh script-head inject always starts checked/visible; keep hide intent
        // from the confirmed layout when the DOM class has not been re-applied yet.
        var confirmedHidden = (
            confirmed_menu_layout
            && Array.isArray(confirmed_menu_layout.hidden)
        ) ? confirmed_menu_layout.hidden : [];
        var shouldHide = dashboard.classList.contains('hidden_menu_item')
            || confirmedHidden.indexOf('switch_dashboard') !== -1;
        if (shouldHide && layout.hidden.indexOf('switch_dashboard') === -1) {
            layout.hidden.push('switch_dashboard');
        }
        return layout;
    }

    // Relocate the parked pattern above. DOM-independent (does not require the
    // dashboard element to exist) so it also runs while healing stored layouts.
    function fix_dashboard_leading_order(layout) {
        if (!dashboard_parked_above_custom(layout)) {
            return layout;
        }
        layout.order.shift();
        layout.order.splice(dashboard_order_insert_index(layout.order), 0, 'switch_dashboard');
        return layout;
    }

    var dashboard_layout_repair_pending = false;
    var dashboard_layout_repairing = false;

    function repair_dashboard_layout_after_inject() {
        if (dashboard_layout_repairing) {
            return;
        }
        var menu = editable_menu_root();
        var dashboard = menu ? menu.querySelector('[data-menu-id="switch_dashboard"]') : null;
        // One repair per injected node — apply() moves this same element and
        // would otherwise re-trigger the observer in a loop.
        if (!dashboard || dashboard.getAttribute('data-em-layout-synced') === '1') {
            return;
        }
        var layout = active_menu_layout();
        if (!layout || !layout.order) {
            return;
        }
        dashboard.setAttribute('data-em-layout-synced', '1');
        dashboard_layout_repairing = true;
        try {
            apply_menu_layout_snapshot(layout);
        } finally {
            dashboard_layout_repairing = false;
        }
    }

    function bind_dashboard_inject_repair() {
        var menuInner = menu_inner_el();
        if (!menuInner || typeof MutationObserver !== 'function') {
            return;
        }
        function schedule_repair() {
            if (dashboard_layout_repair_pending || dashboard_layout_repairing) {
                return;
            }
            dashboard_layout_repair_pending = true;
            setTimeout(function () {
                dashboard_layout_repair_pending = false;
                repair_dashboard_layout_after_inject();
            }, 0);
        }
        var observer = new MutationObserver(function (mutations) {
            if (dashboard_layout_repairing) {
                return;
            }
            for (var i = 0; i < mutations.length; i++) {
                var added = mutations[i].addedNodes;
                for (var j = 0; j < added.length; j++) {
                    var node = added[j];
                    if (
                        node.nodeType === 1
                        && node.getAttribute
                        && node.getAttribute('data-menu-id') === 'switch_dashboard'
                        && node.getAttribute('data-em-layout-synced') !== '1'
                    ) {
                        schedule_repair();
                        return;
                    }
                }
            }
        });
        observer.observe(menuInner, { childList: true });
        if (menuInner.querySelector('[data-menu-id="switch_dashboard"]')) {
            schedule_repair();
        }
    }

    function current_menu_layout() {
        var order = [];
        var hidden = [];
        var storedCustom = stored_custom_items();
        var customItems = {};
        var menuInner = menu_inner_el();
        if (menuInner) {
            query('[data-menu-id]', menuInner).forEach(function (row) {
                if (row.getAttribute('data-menu-item') !== 'true') {
                    return;
                }
                var menuId = row.getAttribute('data-menu-id');
                var isCustom = menuId.indexOf('custom_') === 0;
                if (!isCustom && MENU_ALLOWED_IDS.indexOf(menuId) === -1) {
                    return;
                }
                order.push(menuId);
                if (isCustom && storedCustom[menuId]) {
                    customItems[menuId] = storedCustom[menuId];
                } else if (!isCustom && row.classList.contains('hidden_menu_item')) {
                    hidden.push(menuId);
                }
            });
        }
        if (!order.length) {
            order = MENU_ALLOWED_IDS.slice();
        }
        var layout = { order: order, hidden: hidden };
        if (Object.keys(customItems).length) {
            layout.custom_items = customItems;
        }
        return ensure_dashboard_in_order(fix_dashboard_leading_order(layout));
    }

    function persist_local_layout(revision, layout) {
        try {
            localStorage.removeItem('menu_layout');
            var storageKey = menu_storage_key();
            if (!storageKey) {
                return;
            }
            localStorage.setItem(storageKey, JSON.stringify({
                revision: revision,
                layout: clone_menu_layout(layout),
            }));
        } catch (e) {
            console.warn('[editable menu] failed to cache confirmed menu layout:', e);
        }
    }

    function base_layout_for_custom_op() {
        var stored = active_menu_layout();
        if (stored && stored.order && stored.order.length) {
            return ensure_dashboard_in_order(fix_dashboard_leading_order({
                order: stored.order.slice(),
                hidden: (stored.hidden || []).slice(),
                custom_items: stored.custom_items ? Object.assign({}, stored.custom_items) : {},
            }));
        }
        return current_menu_layout();
    }

    function pin_edit_chrome() {
        var menu = editable_menu_root();
        var slot = by_id('menu_edit_hover_slot');
        var fixture = by_id('menu_edit_fixture');
        if (!menu || !slot) {
            return;
        }
        if (fixture && fixture.parentNode !== slot) {
            slot.appendChild(fixture);
        }
        if (menu.lastElementChild !== slot) {
            menu.appendChild(slot);
        }
    }

    function save_menu_layout() {
        if (!menu_layout_ready) {
            return;
        }
        var layout = current_menu_layout();
        if (!layout.order.length) {
            return;
        }
        pin_edit_chrome();
        queue_menu_mutation('save', layout);
    }

    function reset_menu_layout() {
        if (!menu_layout_ready) {
            return;
        }
        if (typeof window.apply_menu_layout === 'function') {
            window.apply_menu_layout(null);
        }
        queue_menu_mutation('reset', null);
        refresh_menu_pin_buttons();
        update_add_divider_state();
    }

    function clear_menu_reset_confirmation() {
        var button = by_id('menu_edit_reset');
        if (!button || button.getAttribute('data-confirming') !== 'true') {
            return;
        }
        button.textContent = button.getAttribute('data-default-label') || button.textContent;
        button.removeAttribute('data-default-label');
        button.removeAttribute('data-confirming');
        button.classList.remove('menu_edit_reset_confirming');
    }

    function confirm_menu_reset(button) {
        var confirmLabel = button ? button.getAttribute('data-confirm-label') : '';
        if (!button || !confirmLabel) {
            return true;
        }
        if (button.getAttribute('data-confirming') === 'true') {
            clear_menu_reset_confirmation();
            return true;
        }
        button.setAttribute('data-default-label', button.textContent);
        button.setAttribute('data-confirming', 'true');
        button.classList.add('menu_edit_reset_confirming');
        button.textContent = confirmLabel;
        return false;
    }

    function persist_apply_save(layout, onError) {
        if (!menu_layout_ready) {
            return;
        }
        var desiredLayout = clone_menu_layout(layout);
        if (typeof window.apply_menu_layout === 'function') {
            window.apply_menu_layout(desiredLayout);
        }
        queue_menu_mutation('save', desiredLayout, onError);
        refresh_menu_pin_buttons();
    }

    function report_menu_pin_error(message, extra) {
        try {
            var target = window.MENU_PIN_TARGET || {};
            var payload = 'message=' + encodeURIComponent(String(message || 'unknown'))
                + '&path=' + encodeURIComponent(String((extra && extra.path) || target.path || location.pathname || ''))
                + '&obj_type=' + encodeURIComponent(String((extra && extra.obj_type) || target.obj_type || ''))
                + '&obj_id=' + encodeURIComponent(String((extra && extra.obj_id) || target.obj_id || ''));
            xhr_post(api_path_with_debug('/api/add-to-menu-error/'), payload);
        } catch (e) {
            console.warn('[editable menu] failed to report header error:', e);
        }
    }

    function show_menu_runtime_notice(message) {
        console.warn('[editable menu] ' + message);
        var pill = by_id('notification_pill');
        if (pill && typeof show_notification_pill === 'function') {
            show_notification_pill(message);
            return;
        }
        var notice = by_id('editable_menu_notice');
        if (!notice) {
            notice = document.createElement('div');
            notice.id = 'editable_menu_notice';
            notice.className = 'editable_menu_notice';
            notice.setAttribute('role', 'status');
            notice.setAttribute('aria-live', 'assertive');
            document.body.appendChild(notice);
        }
        notice.textContent = message;
        notice.classList.add('visible');
        clearTimeout(menu_notice_timer);
        menu_notice_timer = setTimeout(function () {
            notice.classList.remove('visible');
        }, 5000);
    }

    // Pin search - "search to add to menu" box inside the edit-mode toolbar.
    var MENU_PINS_API_BASE = '/api';
    var menu_pin_search_min_length = 2;
    var menu_pin_search_debounce_ms = 300;
    var menu_pin_search_debounce_timer = null;
    var menu_pin_search_timeout_ms = 30000;
    var menu_pin_search_timeout_timer = null;

    function menu_pin_search_url(searchQuery) {
        var url = api_path_with_debug(MENU_PINS_API_BASE + '/search-menu-pins/');
        // api_path_with_debug() always joins with a bare '?', so the query
        // param has to be appended after it (with the right separator)
        // instead of being baked into the path passed in - otherwise a
        // second '?' would land inside the debug query string.
        var separator = url.indexOf('?') === -1 ? '?' : '&';
        return url + separator + 'q=' + encodeURIComponent(searchQuery);
    }

    // Passed as the same function reference on every xhr_get() call below -
    // xhr_get() auto-aborts whatever request is still in flight under this
    // exact callback before starting a new one (same mechanism search.js
    // already uses to guard against stale responses).
    function on_menu_pin_search_abort() {}

    function build_menu_pin_search_row(item) {
        var row = document.createElement('div');
        row.className = 'menu_add_pin_search_row';
        row.setAttribute('role', 'option');
        // Shared with menu.php's build_custom_menu_item() - one source of
        // truth for "how does a pin's icon resolve."
        var icon = typeof window.build_menu_pin_icon === 'function' ? window.build_menu_pin_icon(item) : null;
        if (icon) {
            row.appendChild(icon);
        }
        var label = document.createElement('span');
        label.className = 'menu_add_pin_search_row_label';
        label.textContent = item.title || '';
        label.title = item.title || ''; // full title on hover, same convention as sidebar rows
        row.appendChild(label);
        var addBtn = document.createElement('button');
        addBtn.type = 'button';
        addBtn.className = 'menu_add_pin_search_row_add';
        // set_add_to_menu_button_state() reads these two dataset attrs
        // (falls back to '' if missing) - #ctrl_add_to_menu already sets
        // them server-side in menu.php; search rows are built client-side,
        // so they must be set here.
        addBtn.setAttribute('data-title-add', intl('Add this to your menu', {
            context: 'Tooltip on the add button for a menu pin-search result row.',
        }));
        addBtn.setAttribute('data-title-remove', intl('Remove this from your menu', {
            context: 'Tooltip on the add button for an already-added menu pin-search result row.',
        }));
        // toggle_pin_target() is bidirectional (adds if not stored, removes
        // if already stored), so the same click handler below covers both
        // add and remove - the initial state just has to reflect reality so
        // clicking an already-pinned result doesn't look like "add" while
        // actually removing it.
        var alreadyAdded = !!stored_custom_items()[custom_menu_id(item.obj_type, item.obj_id)];
        set_add_to_menu_button_state(addBtn, alreadyAdded);
        row.appendChild(addBtn);
        row.addEventListener('click', function () {
            ensure_authoritative_menu_layout(function () {
                // toggle_pin_target() silently no-ops while !menu_layout_ready
                // (see its own guard) - unlike #ctrl_add_to_menu and the
                // sidebar's own .add_to_menu_btn rows, these dynamically
                // rendered buttons aren't covered by refresh_menu_pin_buttons()'s
                // ready/not-ready sweep, so this check has to happen here.
                if (!menu_layout_ready) {
                    show_menu_runtime_notice(intl('Your menu is still syncing - try again in a moment.', {
                        context: 'Shown when a menu pin-search add-click happens before the authoritative menu layout has finished loading',
                    }));
                    return;
                }
                toggle_pin_target(item, function (added) {
                    set_add_to_menu_button_state(addBtn, added);
                });
            });
        });
        return row;
    }

    function build_menu_pin_search_empty_row() {
        var empty = document.createElement('div');
        empty.className = 'menu_add_pin_search_empty';
        empty.textContent = intl('No results', {
            context: 'Shown in the menu pin-search results dropdown when a query matches nothing.',
        });
        return empty;
    }

    function render_menu_pin_search_results(groups) {
        var container = by_id('menu_add_pin_search_results');
        if (!container) {
            return;
        }
        container.innerHTML = '';
        var renderedCount = 0;
        (groups || []).forEach(function (group) {
            if (!group || !group.items || !group.items.length) {
                return;
            }
            var groupLabel = document.createElement('div');
            groupLabel.className = 'menu_add_pin_search_group_label';
            groupLabel.textContent = group.label || '';
            container.appendChild(groupLabel);
            group.items.forEach(function (item) {
                container.appendChild(build_menu_pin_search_row(item));
                renderedCount++;
            });
        });
        if (renderedCount === 0) {
            container.appendChild(build_menu_pin_search_empty_row());
        }
        container.hidden = false;
    }

    function clear_menu_pin_search_results() {
        var container = by_id('menu_add_pin_search_results');
        if (!container) {
            return;
        }
        container.innerHTML = '';
        container.hidden = true;
    }

    // Shown while the debounced request is in flight - typing has stopped
    // (the debounce already fired) but the response hasn't come back yet.
    // Reuses the site's existing loading-spinner asset/pattern (matches
    // .search_key.spinner:before in style-head.css) instead of a new one.
    function render_menu_pin_search_loading() {
        var container = by_id('menu_add_pin_search_results');
        if (!container) {
            return;
        }
        container.innerHTML = '';
        var loading = document.createElement('div');
        loading.className = 'menu_add_pin_search_loading';
        var spinner = document.createElement('div');
        spinner.className = 'menu_add_pin_search_spinner';
        loading.appendChild(spinner);
        container.appendChild(loading);
        container.hidden = false;
    }

    function show_menu_pin_search_failure_notice() {
        show_menu_runtime_notice(intl('Your search could not be completed. Please try again.', {
            context: 'Shown when the menu pin-search request fails (network/HTTP error or invalid response), not for empty search results.',
        }));
    }

    function show_menu_pin_search_timeout_notice() {
        show_menu_runtime_notice(intl('Your search is taking longer than expected. Please try again.', {
            context: 'Shown when the menu pin-search request times out client-side without any server response.',
        }));
    }

    function run_menu_pin_search(searchQuery) {
        render_menu_pin_search_loading();
        // Named function expressions that check their own .aborted flag -
        // same idiom search.js uses. xhr_get() marks the *previous* call's
        // handlers .aborted = true before invoking them when a newer request
        // supersedes them under the same onSearchAbort reference, but that
        // flag isn't always set in time (xhr_get() calls .abort() before
        // setting it, and .abort() fires synchronously) - status === 0 is
        // checked as the reliable fallback signal for "cancelled, not a failure".
        var searchResponseHandler = function (responseText) {
            if (searchResponseHandler.hasOwnProperty('aborted') && searchResponseHandler.aborted) {
                return;
            }
            clearTimeout(menu_pin_search_timeout_timer);
            var data = null;
            try {
                data = JSON.parse(responseText);
            } catch (error) {
                clear_menu_pin_search_results();
                show_menu_pin_search_failure_notice();
                return;
            }
            render_menu_pin_search_results(data && data.groups);
        };
        var searchErrorHandler = function (status) {
            var alreadyFlaggedAborted = searchErrorHandler.hasOwnProperty('aborted') && searchErrorHandler.aborted;
            // status 0 covers both an intentional cancel/supersede/timeout and
            // a hard network failure - there's no reliable way to tell those
            // apart from status alone, and a superseded search hits this on
            // every keystroke, so it's treated as cancelled, not a failure.
            if (alreadyFlaggedAborted || status === 0) {
                clearTimeout(menu_pin_search_timeout_timer);
                return;
            }
            clearTimeout(menu_pin_search_timeout_timer);
            clear_menu_pin_search_results();
            show_menu_pin_search_failure_notice();
        };
        clearTimeout(menu_pin_search_timeout_timer);
        menu_pin_search_timeout_timer = setTimeout(function () {
            // No response/error within menu_pin_search_timeout_ms - most
            // likely a hung connection rather than a slow server (the API
            // itself is a fast Redis/MySQL-backed lookup). Cancels the
            // stalled request (also marks the handlers .aborted, so a very
            // late response can't still land afterward) and surfaces a
            // distinct message rather than leaving the spinner forever.
            cancel_menu_pin_search_request();
            clear_menu_pin_search_results();
            show_menu_pin_search_timeout_notice();
        }, menu_pin_search_timeout_ms);
        xhr_get(menu_pin_search_url(searchQuery), searchResponseHandler, searchErrorHandler, on_menu_pin_search_abort);
    }

    // Directly reads script-head.php's xhr_get_abort_controllers - both are
    // classic (non-module) <script> tags, so they share the page's top-level
    // lexical scope. Same idiom search.js already uses (see its own direct
    // xhr_get_abort_controllers.get(findAbortControllerCallback) reads) to
    // cancel an in-flight request without waiting for a new one to replace
    // it under the same onAbortCallback reference.
    function cancel_menu_pin_search_request() {
        clearTimeout(menu_pin_search_timeout_timer);
        menu_pin_search_timeout_timer = null;
        var controller = typeof xhr_get_abort_controllers !== 'undefined'
            ? xhr_get_abort_controllers.get(on_menu_pin_search_abort)
            : null;
        if (controller) {
            // Mark both handlers .aborted = true ourselves, same as xhr_get()
            // does internally when a newer request supersedes an older one -
            // a direct .abort() here still fires onreadystatechange (status 0),
            // and without this flag the error handler below would treat an
            // intentional cancel (clear/Escape/exit edit mode) as a genuine
            // failure and show a false "search failed" notice.
            if (controller.responseHandler) {
                controller.responseHandler.aborted = true;
            }
            if (controller.errorHandler) {
                controller.errorHandler.aborted = true;
            }
            controller.xhr.abort();
        }
    }

    function update_menu_pin_search_clear_visibility(hasText) {
        var clearBtn = by_id('menu_add_pin_search_clear');
        if (clearBtn) {
            clearBtn.hidden = !hasText;
        }
    }

    function on_menu_pin_search_input(e) {
        var raw = String(e.target.value || '');
        var trimmed = raw.trim();
        update_menu_pin_search_clear_visibility(raw.length > 0);
        if (menu_pin_search_debounce_timer) {
            clearTimeout(menu_pin_search_debounce_timer);
            menu_pin_search_debounce_timer = null;
        }
        if (trimmed.length < menu_pin_search_min_length) {
            clear_menu_pin_search_results();
            return;
        }
        menu_pin_search_debounce_timer = setTimeout(function () {
            run_menu_pin_search(trimmed);
        }, menu_pin_search_debounce_ms);
    }

    query('#menu_add_pin_search_input').forEach(function (input) {
        input.addEventListener('input', on_menu_pin_search_input);
        input.addEventListener('focus', function () {
            ensure_authoritative_menu_layout();
        });
        input.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') {
                // Same effect as clicking #menu_add_pin_search_clear.
                e.stopPropagation();
                reset_menu_pin_search(true);
            }
        });
    });

    // Shared by the clear button and exit_menu_edit_mode() (Done/toggle-off) -
    // without the latter, a previous search's results/query stayed behind
    // when re-entering edit mode, since nothing ever reset them on exit.
    function reset_menu_pin_search(focusInput) {
        var input = by_id('menu_add_pin_search_input');
        if (menu_pin_search_debounce_timer) {
            clearTimeout(menu_pin_search_debounce_timer);
            menu_pin_search_debounce_timer = null;
        }
        cancel_menu_pin_search_request();
        clear_menu_pin_search_results();
        update_menu_pin_search_clear_visibility(false);
        if (input) {
            input.value = '';
            if (focusInput) {
                input.focus();
            }
        }
    }

    query('#menu_add_pin_search_clear').forEach(function (clearBtn) {
        clearBtn.addEventListener('click', function () {
            reset_menu_pin_search(true);
        });
    });

    // Purely diagnostic helpers - do not change any control flow. Used only
    // inside existing failure branches to explain *why* parse_server_menu_state()
    // (untouched, still the single source of truth for validation) returned
    // null, since sync_failure: invalid_menu_layout_payload / save_rejected:
    // invalid_response / etc. previously gave no actionable detail in
    // editable_menu.log.
    function summarize_menu_diag_value(value) {
        if (value === null) {
            return 'null';
        }
        var type = typeof value;
        if (type === 'string') {
            return summarize_menu_diag_string(value);
        }
        if (type === 'number' || type === 'boolean' || type === 'undefined') {
            return String(value) + ' (' + type + ')';
        }
        try {
            return summarize_menu_diag_string(JSON.stringify(value)) + ' (' + type + ')';
        } catch (e) {
            return '(' + type + ', unserializable)';
        }
    }

    function summarize_menu_diag_string(str) {
        var normalized = String(str === null || str === undefined ? '' : str).replace(/[\r\n]+/g, ' ');
        if (normalized.length > 200) {
            return normalized.slice(0, 200) + ' (truncated, len=' + normalized.length + ')';
        }
        return normalized;
    }

    // Pinpoints which specific check inside is_valid_menu_layout() failed -
    // that function itself stays a single boolean predicate (untouched), this
    // just re-derives the same checks in the same order for a diagnostic string.
    function describe_menu_layout_shape_issue(layout) {
        if (!layout || typeof layout !== 'object' || Array.isArray(layout)) {
            return "not an object";
        }
        if (!Array.isArray(layout.order)) {
            return "missing 'order'";
        }
        if (!Array.isArray(layout.hidden)) {
            return "missing 'hidden'";
        }
        if (
            typeof layout.custom_items !== 'undefined'
            && (!layout.custom_items || typeof layout.custom_items !== 'object' || Array.isArray(layout.custom_items))
        ) {
            return "invalid 'custom_items'";
        }
        return 'unknown shape issue';
    }

    // Re-runs the *exact same checks* as parse_server_menu_state(), in the
    // same order, but returns a "reason=..." diagnostic string instead of
    // null. Only ever called from inside the existing `if (!state)` branches
    // that already call parse_server_menu_state() - never changes control
    // flow, and parse_server_menu_state() itself is untouched.
    function describe_menu_state_failure(data, layoutKey) {
        if (!data || typeof data !== 'object') {
            return 'reason=response_not_object value=' + summarize_menu_diag_value(data);
        }
        if (!Object.prototype.hasOwnProperty.call(data, layoutKey)) {
            return 'reason=missing_layout_key key=' + layoutKey;
        }
        if (!Number.isInteger(data.revision)) {
            if (!Object.prototype.hasOwnProperty.call(data, 'revision')) {
                return 'reason=missing_revision';
            }
            return 'reason=invalid_revision revision=' + summarize_menu_diag_value(data.revision);
        }
        if (data.revision < 0) {
            return 'reason=negative_revision revision=' + data.revision;
        }
        if (data[layoutKey] !== null) {
            if (typeof data[layoutKey] !== 'string') {
                return 'reason=layout_not_string layout_type=' + typeof data[layoutKey];
            }
            var layout = null;
            try {
                layout = JSON.parse(data[layoutKey]);
            } catch (e) {
                return 'reason=layout_json_parse_error layout_json=' + summarize_menu_diag_string(data[layoutKey]);
            }
            if (!is_valid_menu_layout(layout)) {
                return 'reason=layout_shape_invalid layout_json=' + summarize_menu_diag_string(data[layoutKey])
                    + ' (' + describe_menu_layout_shape_issue(layout) + ')';
            }
        }
        // Every check above matches parse_server_menu_state()'s own checks -
        // reaching here would mean parse_server_menu_state() actually
        // succeeded, so describe_menu_state_failure() should never be called
        // for this data in practice (callers only invoke it when state is null).
        return 'reason=unknown';
    }

    function parse_server_menu_state(data, layoutKey) {
        if (
            !data
            || typeof data !== 'object'
            || !Object.prototype.hasOwnProperty.call(data, layoutKey)
            || !Number.isInteger(data.revision)
            || data.revision < 0
        ) {
            return null;
        }
        var layout = null;
        if (data[layoutKey] !== null) {
            if (typeof data[layoutKey] !== 'string') {
                return null;
            }
            try {
                layout = JSON.parse(data[layoutKey]);
            } catch (e) {
                return null;
            }
            if (!is_valid_menu_layout(layout)) {
                return null;
            }
        }
        return {
            revision: data.revision,
            layout: clone_menu_layout(layout),
        };
    }

    function apply_menu_layout_snapshot(layout) {
        var next = clone_menu_layout(layout);
        if (next) {
            fix_dashboard_leading_order(next);
        }
        if (typeof window.apply_menu_layout === 'function') {
            window.apply_menu_layout(next);
        }
        pin_edit_chrome();
        refresh_menu_pin_buttons();
        update_add_divider_state();
    }

    function apply_confirmed_menu_state(state) {
        menu_layout_revision = state.revision;
        confirmed_menu_layout = clone_menu_layout(state.layout);
        // Keep the sync/mutation source of truth clean too: a server layout that
        // still carries the parked-dashboard artifact would otherwise re-dirty
        // localStorage on every sync and defeat the read-time heal.
        if (confirmed_menu_layout) {
            fix_dashboard_leading_order(confirmed_menu_layout);
        }
        window.MENU_LAYOUT_REVISION = menu_layout_revision;
        persist_local_layout(menu_layout_revision, confirmed_menu_layout);
        apply_menu_layout_snapshot(confirmed_menu_layout);
    }

    function restore_confirmed_menu_layout() {
        persist_local_layout(menu_layout_revision, confirmed_menu_layout);
        apply_menu_layout_snapshot(confirmed_menu_layout);
    }

    function notify_menu_mutation_flush_waiters() {
        if (menu_mutation_in_flight || queued_menu_mutation) {
            return;
        }
        var callbacks = menu_mutation_flush_callbacks.slice();
        menu_mutation_flush_callbacks = [];
        for (var i = 0; i < callbacks.length; i++) {
            try {
                callbacks[i]();
            } catch (e) {
                console.warn('[editable menu] flush callback failed:', e);
            }
        }
    }

    function fail_menu_mutation(errorCode, noticeMessage) {
        var failedMutation = menu_mutation_in_flight;
        menu_mutation_in_flight = null;
        queued_menu_mutation = null;
        restore_confirmed_menu_layout();
        if (failedMutation && typeof failedMutation.onError === 'function') {
            failedMutation.onError(errorCode);
        }
        report_menu_pin_error('save_failure: ' + String(errorCode || 'unknown'));
        show_menu_runtime_notice(noticeMessage);
        notify_menu_mutation_flush_waiters();
    }

    function finish_menu_mutation_success(state) {
        var nextMutation = queued_menu_mutation;
        menu_mutation_in_flight = null;
        queued_menu_mutation = null;
        apply_confirmed_menu_state(state);
        if (nextMutation) {
            send_menu_mutation(nextMutation);
            apply_menu_layout_snapshot(nextMutation.layout);
        } else {
            notify_menu_mutation_flush_waiters();
        }
    }

    function finish_menu_mutation_conflict(response) {
        var failedMutation = menu_mutation_in_flight;
        var state = parse_server_menu_state(response, 'layout');
        if (!state || response.code !== 'revision_conflict') {
            // Distinguish an actually-invalid layout from an unexpected
            // response.code value - today both collapsed into a bare
            // "revision_conflict_invalid_response".
            var conflictReason = !state
                ? describe_menu_state_failure(response, 'layout')
                : 'code=unexpected_value expected=revision_conflict got=' + summarize_menu_diag_value(response && response.code);
            fail_menu_mutation(
                'revision_conflict_invalid_response ' + conflictReason + ' client=' + menu_layout_user_id(),
                intl('Your menu could not be synchronized. The last saved menu was restored.', {
                    context: 'Visible error after a malformed menu revision-conflict response',
                })
            );
            return;
        }
        menu_mutation_in_flight = null;
        queued_menu_mutation = null;
        apply_confirmed_menu_state(state);
        if (failedMutation && typeof failedMutation.onError === 'function') {
            failedMutation.onError('revision_conflict');
        }
        show_menu_runtime_notice(intl('Your menu changed elsewhere. The latest saved menu was restored.', {
            context: 'Visible notice after a menu edit conflicts with a newer server revision',
        }));
        notify_menu_mutation_flush_waiters();
    }

    function send_menu_mutation(mutation) {
        menu_mutation_in_flight = mutation;
        var request = new XMLHttpRequest();
        request.onreadystatechange = function () {
            if (request.readyState !== 4) {
                return;
            }
            var response = null;
            try {
                response = JSON.parse(request.responseText || '{}');
            } catch (e) {}
            if (request.status === 409) {
                finish_menu_mutation_conflict(response);
                return;
            }
            if (request.status !== 200) {
                fail_menu_mutation(
                    'save_http_' + request.status
                        + ((response && response.message) ? (': ' + response.message) : ''),
                    intl('Menu changes could not be saved. The last saved menu was restored.', {
                        context: 'Visible error after an HTTP failure while saving the editable menu',
                    })
                );
                return;
            }
            var state = response
                && response.success === true
                && response.action === mutation.action
                ? parse_server_menu_state(response, 'layout')
                : null;
            if (!state) {
                // Distinguish the 3 ways this can fail - today they all
                // collapsed into a single useless "invalid_response".
                var saveRejectedReason;
                if (!response || response.success !== true) {
                    saveRejectedReason = 'response_not_success'
                        + (response && response.message ? ' message=' + summarize_menu_diag_string(response.message) : '');
                } else if (response.action !== mutation.action) {
                    saveRejectedReason = 'action_mismatch expected=' + mutation.action
                        + ' got=' + summarize_menu_diag_value(response.action);
                } else {
                    saveRejectedReason = describe_menu_state_failure(response, 'layout');
                }
                fail_menu_mutation(
                    'save_rejected: ' + saveRejectedReason + ' client=' + menu_layout_user_id(),
                    intl('Menu changes could not be saved. The last saved menu was restored.', {
                        context: 'Visible error after menu layout validation or an invalid save response',
                    })
                );
                return;
            }
            finish_menu_mutation_success(state);
        };
        request.open('POST', api_path_with_debug('/api/save-menu-layout/'), true);
        request.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
        request.setRequestHeader('Content-type', 'application/x-www-form-urlencoded');
        var payload = 'action=' + encodeURIComponent(mutation.action)
            + '&base_revision=' + encodeURIComponent(String(menu_layout_revision));
        if (mutation.action === 'save') {
            payload += '&layout=' + encodeURIComponent(JSON.stringify(mutation.layout));
        }
        request.send(payload);
    }

    function queue_menu_mutation(action, layout, onError) {
        if (!menu_layout_ready) {
            return;
        }
        var mutation = {
            action: action,
            layout: clone_menu_layout(layout),
            onError: onError,
        };
        // Cache optimistically so Free Mode navigation/reload keeps the edit even if
        // the save XHR is aborted mid-flight (T-8526). Confirmed revision still bumps
        // only after a successful server response.
        if (action === 'save') {
            persist_local_layout(menu_layout_revision, mutation.layout);
        } else if (action === 'reset') {
            persist_local_layout(menu_layout_revision, null);
        }
        if (menu_mutation_in_flight) {
            queued_menu_mutation = mutation;
            return;
        }
        send_menu_mutation(mutation);
    }

    // Used by Free Mode toggle (script.js) so in-flight menu saves finish before
    // subdomain hop / reload aborts the XHR.
    window.flushPendingMenuLayoutSaves = function (done, timeoutMs) {
        var finished = false;
        var finish = function () {
            if (finished) {
                return;
            }
            finished = true;
            if (typeof done === 'function') {
                try {
                    done();
                } catch (e) {
                    console.warn('[editable menu] flush done failed:', e);
                }
            }
        };
        if (!menu_mutation_in_flight && !queued_menu_mutation) {
            finish();
            return;
        }
        menu_mutation_flush_callbacks.push(finish);
        var waitMs = typeof timeoutMs === 'number' && timeoutMs >= 0 ? timeoutMs : 2000;
        setTimeout(finish, waitMs);
    };

    // Cross-subdomain sync_storage may import a newer menu_layout envelope after
    // first paint. Adopt it into the editable-menu runtime (T-8526).
    window.apply_synced_menu_layout_envelope = function (envelope) {
        if (
            !envelope
            || !Number.isInteger(envelope.revision)
            || envelope.revision < 0
        ) {
            return;
        }
        if (envelope.revision < menu_layout_revision) {
            return;
        }
        if (
            envelope.revision === menu_layout_revision
            && (menu_mutation_in_flight || queued_menu_mutation)
        ) {
            return;
        }
        if (
            envelope.layout !== null
            && !is_valid_menu_layout(envelope.layout)
        ) {
            return;
        }
        if (envelope.revision > menu_layout_revision) {
            menu_mutation_in_flight = null;
            queued_menu_mutation = null;
        }
        apply_confirmed_menu_state({
            revision: envelope.revision,
            layout: clone_menu_layout(envelope.layout),
        });
        notify_menu_mutation_flush_waiters();
    };
    if (window.__pending_synced_menu_layout_envelope) {
        var pending_synced_envelope = window.__pending_synced_menu_layout_envelope;
        window.__pending_synced_menu_layout_envelope = null;
        window.apply_synced_menu_layout_envelope(pending_synced_envelope);
    }

    function flush_menu_layout_sync_callbacks() {
        var callbacks = menu_layout_sync_callbacks.slice();
        menu_layout_sync_callbacks = [];
        for (var i = 0; i < callbacks.length; i++) {
            try {
                callbacks[i]();
            } catch (e) {
                console.warn('[editable menu] sync callback failed:', e);
            }
        }
    }

    function sync_authoritative_menu_layout(onDone) {
        if (typeof onDone === 'function') {
            if (menu_layout_authoritative) {
                onDone();
                return;
            }
            menu_layout_sync_callbacks.push(onDone);
        }
        if (menu_layout_sync_started) {
            return;
        }
        menu_layout_sync_started = true;
        var debugQuery = String(window.DEBUG_PARAMS || '').replace(/^[?&]+/, '');
        var accountUrl = '/api/account/?obj_type=0&obj_id=0' + (debugQuery ? '&' + debugQuery : '');
        if (typeof xhr_get !== 'function') {
            report_menu_pin_error('sync_failure: xhr_get_unavailable');
            show_menu_runtime_notice(intl('Your menu could not be synchronized. Editing is unavailable.', {
                context: 'Visible error when the initial authoritative editable-menu account sync fails',
            }));
            flush_menu_layout_sync_callbacks();
            return;
        }
        xhr_get(accountUrl, function (responseText) {
            var data = null;
            try {
                data = JSON.parse(responseText || '{}');
            } catch (e) {}
            var clientUserId = menu_layout_user_id();
            var bakedUserId = parseInt(window.MENU_LAYOUT_USER_ID, 10) || 0;
            // Guest / logged-out: account returns {error: 'Not logged in'}.
            if (data && data.error) {
                if (data.error === 'Not logged in') {
                    window.MENU_LAYOUT_USER_ID = 0;
                    menu_layout_revision = 0;
                    confirmed_menu_layout = null;
                    menu_layout_authoritative = true;
                    apply_menu_layout_snapshot(null);
                    set_menu_controls_ready(true);
                    flush_menu_layout_sync_callbacks();
                    return;
                }
                report_menu_pin_error(
                    'sync_failure: account_error'
                    + ' err=' + String(data.error)
                    + ' client=' + clientUserId
                    + ' baked=' + bakedUserId
                );
                if (clientUserId > 0) {
                    show_menu_runtime_notice(intl('Your menu could not be synchronized. Editing is unavailable.', {
                        context: 'Visible error when the initial authoritative editable-menu account sync fails',
                    }));
                }
                flush_menu_layout_sync_callbacks();
                return;
            }
            var accountUserId = data ? parseInt(data.id, 10) : 0;
            if (!data || !(accountUserId > 0)) {
                report_menu_pin_error(
                    'sync_failure: account_missing_id'
                    + ' client=' + clientUserId
                    + ' baked=' + bakedUserId
                );
                if (clientUserId > 0) {
                    show_menu_runtime_notice(intl('Your menu could not be synchronized. Editing is unavailable.', {
                        context: 'Visible error when the initial authoritative editable-menu account sync fails',
                    }));
                }
                flush_menu_layout_sync_callbacks();
                return;
            }
            // Session cookie is source of truth. Cached HTML may have baked another
            // user's MENU_LAYOUT_USER_ID; realign client identity to the account id.
            window.MENU_LAYOUT_USER_ID = accountUserId;
            if (window.USER && parseInt(window.USER.id, 10) !== accountUserId) {
                window.USER.id = accountUserId;
            }
            var state = parse_server_menu_state({
                revision: data.menu_layout_revision,
                menu_layout: data.menu_layout,
            }, 'menu_layout');
            if (!state) {
                report_menu_pin_error(
                    'sync_failure: invalid_menu_layout_payload '
                    + describe_menu_state_failure({
                        revision: data.menu_layout_revision,
                        menu_layout: data.menu_layout,
                    }, 'menu_layout')
                    + ' client=' + clientUserId
                    + ' baked=' + bakedUserId
                );
                show_menu_runtime_notice(intl('Your menu could not be synchronized. Editing is unavailable.', {
                    context: 'Visible error when the initial editable-menu account response is invalid',
                }));
                flush_menu_layout_sync_callbacks();
                return;
            }
            menu_layout_authoritative = true;
            apply_confirmed_menu_state(state);
            set_menu_controls_ready(true);
            flush_menu_layout_sync_callbacks();
        }, function (status) {
            // A bare HTTP failure has no parse reason to add (xhr_get() only
            // hands back the status code) - client= just lets repeat
            // failures from the same user be correlated in the log.
            report_menu_pin_error('sync_failure: http_' + String(status || 'unknown') + ' client=' + menu_layout_user_id());
            if (menu_layout_user_id() > 0) {
                show_menu_runtime_notice(intl('Your menu could not be synchronized. Editing is unavailable.', {
                    context: 'Visible error after an HTTP failure during initial editable-menu account sync',
                }));
            }
            console.warn('[editable menu] account sync HTTP status:', status);
            flush_menu_layout_sync_callbacks();
        });
    }

    function ensure_authoritative_menu_layout(onDone) {
        if (menu_layout_user_id() <= 0 || menu_layout_authoritative) {
            if (typeof onDone === 'function') {
                onDone();
            }
            return;
        }
        sync_authoritative_menu_layout(onDone);
    }

    function schedule_lazy_menu_sync(mode) {
        if (lazy_menu_sync_scheduled || menu_layout_authoritative || menu_layout_user_id() <= 0) {
            return;
        }
        lazy_menu_sync_scheduled = true;
        if (mode === 'idle') {
            var startIdleSync = function () {
                ensure_authoritative_menu_layout();
            };
            if (typeof window.requestIdleCallback === 'function') {
                window.requestIdleCallback(startIdleSync, { timeout: 4000 });
            } else {
                setTimeout(startIdleSync, 1500);
            }
            var menuEl = editable_menu_root();
            if (menuEl) {
                menuEl.addEventListener('pointerenter', function onMenuHover() {
                    menuEl.removeEventListener('pointerenter', onMenuHover);
                    ensure_authoritative_menu_layout();
                });
            }
            return;
        }
        var armed = false;
        var arm = function () {
            if (armed) {
                return;
            }
            armed = true;
            ensure_authoritative_menu_layout();
        };
        document.addEventListener('click', function onFirstMenuMutationClick(e) {
            if (
                e.target.closest('#ctrl_add_to_menu, #menu_edit_toggle, #menu_edit_reset, #menu_add_divider, .add_to_menu_btn, .menu_item_remove, .menu_item_hide_toggle')
            ) {
                document.removeEventListener('click', onFirstMenuMutationClick, true);
                arm();
            }
        }, true);
        var hoverSlot = by_id('menu_edit_hover_slot');
        if (hoverSlot) {
            hoverSlot.addEventListener('pointerenter', function onEditChromeHover() {
                hoverSlot.removeEventListener('pointerenter', onEditChromeHover);
                arm();
            });
        }
    }

    function custom_menu_id(objType, objId) {
        return 'custom_' + objType + '_' + objId;
    }

    function menu_is_expanded(menu) {
        if (!menu) {
            return false;
        }
        if (menu.classList.contains('edit_menu') || document.body.classList.contains('expanded_menu')) {
            return true;
        }
        try {
            return menu.matches(':hover');
        } catch (e) {
            return false;
        }
    }

    function set_edit_chrome_reveal(on) {
        var menu = editable_menu_root();
        if (!menu) {
            return;
        }
        menu.classList.toggle('menu_edit_chrome_reveal', !!on && menu_is_expanded(menu));
    }

    function schedule_edit_chrome_hide() {
        clearTimeout(edit_chrome_hide_timer);
        edit_chrome_hide_timer = setTimeout(function () {
            edit_chrome_pull = 0;
            var menu = editable_menu_root();
            var slot = by_id('menu_edit_hover_slot');
            if (slot && slot.matches(':hover') && menu_is_expanded(menu)) {
                return;
            }
            set_edit_chrome_reveal(false);
        }, 1600);
    }

    function bind_edit_chrome_pull() {
        if (edit_chrome_wheel_bound) {
            return;
        }
        var menu = editable_menu_root();
        if (!menu) {
            return;
        }
        edit_chrome_wheel_bound = true;
        var menuInner = menu_inner_el() || menu;
        menu.addEventListener('wheel', function (e) {
            if (menu.classList.contains('edit_menu') || !menu.contains(e.target) || !menu_is_expanded(menu)) {
                return;
            }
            var atBottom = (menuInner.scrollTop + menuInner.clientHeight) >= (menuInner.scrollHeight - 1);
            if (atBottom && e.deltaY > 0) {
                e.preventDefault();
                edit_chrome_pull += Math.abs(e.deltaY);
                if (edit_chrome_pull >= 24) {
                    set_edit_chrome_reveal(true);
                    schedule_edit_chrome_hide();
                }
            } else if (e.deltaY < 0) {
                edit_chrome_pull = 0;
                set_edit_chrome_reveal(false);
            }
        }, { passive: false, capture: true });

        var touchStartY = null;
        menu.addEventListener('touchstart', function (e) {
            var atBottom = (menuInner.scrollTop + menuInner.clientHeight) >= (menuInner.scrollHeight - 1);
            touchStartY = atBottom ? e.touches[0].clientY : null;
        }, { passive: true, capture: true });
        menu.addEventListener('touchmove', function (e) {
            if (touchStartY === null || menu.classList.contains('edit_menu') || !menu_is_expanded(menu)) {
                return;
            }
            var deltaY = e.touches[0].clientY - touchStartY;
            if (deltaY < -24) {
                set_edit_chrome_reveal(true);
                schedule_edit_chrome_hide();
            } else if (deltaY > 16) {
                edit_chrome_pull = 0;
                clearTimeout(edit_chrome_hide_timer);
                set_edit_chrome_reveal(false);
            }
        }, { passive: true, capture: true });

        menu.addEventListener('mouseleave', function () {
            if (!menu.classList.contains('edit_menu') && !document.body.classList.contains('expanded_menu')) {
                edit_chrome_pull = 0;
                set_edit_chrome_reveal(false);
            }
        });
    }

    function remove_custom_menu_item(id) {
        var layout = base_layout_for_custom_op();
        layout.order = layout.order.filter(function (itemId) { return itemId !== id; });
        if (layout.custom_items) {
            delete layout.custom_items[id];
        }
        persist_apply_save(layout, function (errorMessage) {
            report_menu_pin_error(errorMessage, { path: (window.MENU_PIN_TARGET && window.MENU_PIN_TARGET.path) || '' });
        });
        refresh_menu_pin_buttons();
        update_add_divider_state();
    }

    function set_add_to_menu_button_state(button, added) {
        button.classList.toggle('added', added);
        var title = button.getAttribute(added ? 'data-title-remove' : 'data-title-add') || '';
        button.setAttribute('title', title);
        if (button.id === 'ctrl_add_to_menu') {
            button.setAttribute('aria-label', title);
        }
    }

    function normalize_menu_path(pathname) {
        var path = String(pathname || '/');
        if (typeof app_display_language_codes !== 'undefined' && app_display_language_codes.length) {
            path = path.replace(new RegExp('^/(' + app_display_language_codes.join('|') + ')(?=/|$)', 'i'), '') || '/';
        }
        path = path.replace(/\.php$/i, '');
        if (path.length > 1) {
            path = path.replace(/\/$/, '');
        }
        path = path.toLowerCase();
        return path === '/index' ? '/' : path;
    }

    function is_app_hostname(hostname) {
        var host = String(hostname || '').toLowerCase();
        if (!host) {
            return false;
        }
        if (host === location.hostname.toLowerCase()) {
            return true;
        }
        var appHost = typeof app_domain !== 'undefined' && app_domain
            ? String(app_domain).toLowerCase()
            : '';
        return !!appHost && (
            host === appHost
            || host === 'www.' + appHost
            || host === 'free.' + appHost
        );
    }

    function is_default_menu_page() {
        var target = window.MENU_PIN_TARGET;
        if (target && target.default_in_menu) {
            return true;
        }
        var current = normalize_menu_path(location.pathname);
        var defaults = window.MENU_DEFAULT_PATHS || [];
        for (var i = 0; i < defaults.length; i++) {
            if (normalize_menu_path(defaults[i]) === current) {
                return true;
            }
        }
        var menuInner = menu_inner_el();
        if (!menuInner) {
            return false;
        }
        var links = menuInner.querySelectorAll('a[data-menu-id][href]');
        for (var linkIndex = 0; linkIndex < links.length; linkIndex++) {
            var menuId = links[linkIndex].getAttribute('data-menu-id') || '';
            if (!menuId || menuId.indexOf('custom_') === 0 || menuId.indexOf('divider') === 0) {
                continue;
            }
            var href = links[linkIndex].getAttribute('href') || '';
            if (!href || href.charAt(0) === '#' || href.indexOf('javascript:') === 0) {
                continue;
            }
            if (/^https?:\/\//i.test(href)) {
                try {
                    if (!is_app_hostname(new URL(href).hostname)) {
                        continue;
                    }
                } catch (e) {
                    continue;
                }
            }
            try {
                if (normalize_menu_path(new URL(href, location.origin).pathname) === current) {
                    return true;
                }
            } catch (e2) {}
        }
        return false;
    }

    function pin_target_entry() {
        var target = window.MENU_PIN_TARGET;
        if (!target || target.default_in_menu) {
            return null;
        }
        var objId = parseInt(target.obj_id, 10);
        if (!target.obj_type || !objId) {
            return null;
        }
        var entry = { obj_type: target.obj_type, obj_id: objId, title: target.title || '' };
        ['path', 'image', 'emoji'].forEach(function (key) {
            if (target[key]) {
                entry[key] = target[key];
            }
        });
        return entry;
    }

    function clear_pin_reveal(menu, openedMobile, token) {
        if (token !== pin_reveal_token) {
            return;
        }
        if (menu) {
            menu.classList.remove('menu_pin_reveal', 'menu_edit_chrome_reveal');
            menu.scrollTop = 0;
            var inner = menu.querySelector('.menu_inner');
            if (inner) {
                inner.scrollTop = 0;
            }
        }
        if (openedMobile) {
            document.body.classList.remove('expanded_menu', 'menu_pin_reveal_open');
        }
        pin_edit_chrome();
    }

    function flash_menu_item(id) {
        var menu = editable_menu_root();
        var row = menu ? menu.querySelector('[data-menu-id="' + id + '"]') : null;
        if (!row) {
            return;
        }
        var openedMobile = false;
        var wasExpanded = document.body.classList.contains('expanded_menu');
        var token = ++pin_reveal_token;
        clearTimeout(pin_reveal_timer);
        if (menu) {
            menu.classList.add('menu_pin_reveal');
            menu.scrollTop = 0;
            var inner = menu.querySelector('.menu_inner');
            if (inner) {
                inner.scrollTop = 0;
            }
        }
        if (window.matchMedia('(max-width: 500px)').matches && !wasExpanded) {
            document.body.classList.add('expanded_menu', 'menu_pin_reveal_open');
            openedMobile = true;
        }
        row.classList.remove('menu_item_flash');
        void row.offsetWidth;
        row.classList.add('menu_item_flash');
        pin_reveal_timer = setTimeout(function () {
            row.classList.remove('menu_item_flash');
            clear_pin_reveal(menu, openedMobile, token);
        }, 1400);
    }

    function release_pin_button_settle() {
        var headerButton = by_id('ctrl_add_to_menu');
        if (headerButton) {
            headerButton.classList.remove(
                'ctrl_add_to_menu_flash',
                'ctrl_add_to_menu_settling'
            );
            headerButton.removeEventListener('animationend', on_pin_button_confirm_end);
            headerButton.removeEventListener('mouseleave', release_pin_button_settle);
        }
        pin_button_settle_cleanup = null;
    }

    function on_pin_button_confirm_end(e) {
        var headerButton = by_id('ctrl_add_to_menu');
        if (!headerButton || e.target !== headerButton) {
            return;
        }
        headerButton.classList.remove('ctrl_add_to_menu_flash');
        // Keep settling (no hover red/amber) until the pointer leaves.
        if (!headerButton.matches(':hover')) {
            release_pin_button_settle();
        }
    }

    function play_pin_button_confirm(added) {
        // Add only — remove has no confirm flash.
        // Still clear any in-flight add confirm so add→remove does not keep flashing.
        if (!added) {
            if (typeof pin_button_settle_cleanup === 'function') {
                pin_button_settle_cleanup();
            }
            return;
        }
        var headerButton = by_id('ctrl_add_to_menu');
        if (!headerButton) {
            return;
        }
        if (typeof pin_button_settle_cleanup === 'function') {
            pin_button_settle_cleanup();
        }
        headerButton.classList.remove(
            'ctrl_add_to_menu_flash',
            'ctrl_add_to_menu_settling'
        );
        void headerButton.offsetWidth;
        headerButton.classList.add('ctrl_add_to_menu_settling');
        headerButton.classList.add('ctrl_add_to_menu_flash');
        headerButton.addEventListener('animationend', on_pin_button_confirm_end);
        headerButton.addEventListener('mouseleave', release_pin_button_settle);
        pin_button_settle_cleanup = release_pin_button_settle;
    }

    function notify_pin_change(added, entry) {
        play_pin_button_confirm(added);
        if (typeof show_notification_pill !== 'function') {
            return;
        }
        if (typeof notification_pill === 'undefined' || !notification_pill) {
            notification_pill = by_id('notification_pill');
        }
        if (!notification_pill) {
            return;
        }
        var title = entry && entry.title ? String(entry.title) : '';
        var message = added
            ? (title ? intl('{title} added to menu', { values: { title: title }, context: 'Toast after pinning the current page to the left navigation menu' }) : intl('Added to menu', { context: 'Toast after pinning the current page to the left navigation menu (no title available)' }))
            : (title ? intl('{title} removed from menu', { values: { title: title }, context: 'Toast after unpinning the current page from the left navigation menu' }) : intl('Removed from menu', { context: 'Toast after unpinning the current page from the left navigation menu (no title available)' }));
        show_notification_pill(message);
    }

    function menu_order_is_full(layout) {
        return !!layout && Array.isArray(layout.order) && layout.order.length >= MENU_MAX_ORDERED_ITEMS;
    }

    function insert_new_menu_order_item(layout, id) {
        var menu = editable_menu_root();
        if (menu && menu.getAttribute('data-new-items-position') === 'end') {
            layout.order.push(id);
            return;
        }
        layout.order.unshift(id);
    }

    function show_menu_full_notice() {
        if (typeof show_notification_pill === 'function') {
            show_notification_pill(intl('Menu is full (max {max} items)', {
                values: { max: MENU_MAX_ORDERED_ITEMS },
                context: 'Toast shown when the user tries to add an item after reaching the maximum ordered menu item count',
            }));
        }
    }

    function toggle_pin_target(entry, onStateChange) {
        if (!menu_layout_ready || !entry || !entry.obj_type || !entry.obj_id) {
            return;
        }
        var id = custom_menu_id(entry.obj_type, entry.obj_id);
        var stored = stored_custom_items();
        if (stored[id]) {
            if (typeof onStateChange === 'function') {
                onStateChange(false);
            }
            remove_custom_menu_item(id);
            notify_pin_change(false, entry);
            return;
        }
        var layout = base_layout_for_custom_op();
        if (menu_order_is_full(layout)) {
            show_menu_full_notice();
            return;
        }
        layout.custom_items = layout.custom_items || {};
        layout.custom_items[id] = entry;
        insert_new_menu_order_item(layout, id);
        if (typeof onStateChange === 'function') {
            onStateChange(true);
        }
        persist_apply_save(layout, function (errorMessage) {
            report_menu_pin_error(errorMessage, { obj_type: entry.obj_type, obj_id: entry.obj_id, path: entry.path || '' });
        });
        refresh_menu_pin_buttons();
        notify_pin_change(true, entry);
        setTimeout(function () { flash_menu_item(id); }, 220);
    }

    function toggle_add_menu_item(button) {
        var objType = button.getAttribute('data-obj-type');
        var objId = parseInt(button.getAttribute('data-obj-id'), 10);
        if (!objType || !objId) {
            return;
        }
        var entry = { obj_type: objType, obj_id: objId, title: button.getAttribute('data-title') || '' };
        ['path', 'image', 'emoji'].forEach(function (key) {
            var value = button.getAttribute('data-' + key) || '';
            if (value) {
                entry[key] = value;
            }
        });
        toggle_pin_target(entry, function (added) {
            set_add_to_menu_button_state(button, added);
        });
    }

    function count_custom_dividers() {
        var custom = stored_custom_items();
        var count = 0;
        for (var key in custom) {
            if (custom.hasOwnProperty(key) && custom[key] && custom[key].type === 'divider') {
                count++;
            }
        }
        return count;
    }

    function add_menu_divider() {
        if (!menu_layout_ready || count_custom_dividers() >= 3) {
            return;
        }
        var layout = base_layout_for_custom_op();
        if (menu_order_is_full(layout)) {
            show_menu_full_notice();
            update_add_divider_state();
            return;
        }
        var id = 'custom_divider_' + Date.now() + Math.floor(Math.random() * 1000);
        layout.custom_items = layout.custom_items || {};
        layout.custom_items[id] = { type: 'divider' };
        insert_new_menu_order_item(layout, id);
        persist_apply_save(layout);
        update_add_divider_state();
    }

    function update_add_divider_state() {
        var button = by_id('menu_add_divider');
        if (!button) {
            return;
        }
        if (!menu_layout_ready) {
            button.classList.add('disabled');
            button.disabled = true;
            return;
        }
        var atCap = count_custom_dividers() >= 3 || menu_order_is_full(base_layout_for_custom_op());
        button.classList.toggle('disabled', atCap);
        button.disabled = atCap;
    }

    function set_menu_controls_ready(ready) {
        menu_layout_ready = !!ready;
        var loggedIn = menu_layout_user_id() > 0;
        var fixture = by_id('menu_edit_fixture');
        if (fixture) {
            fixture.style.display = menu_layout_ready && loggedIn ? '' : 'none';
        }
        query('#menu_edit_toggle, #menu_edit_done, #menu_edit_reset').forEach(function (button) {
            button.disabled = !menu_layout_ready;
        });
        if (!menu_layout_ready) {
            exit_menu_edit_mode();
        }
        refresh_menu_pin_buttons();
        update_add_divider_state();
    }

    function refresh_menu_pin_buttons() {
        var loggedIn = menu_layout_user_id() > 0;
        var custom = stored_custom_items();
        query('.add_to_menu_btn').forEach(function (button) {
            if (!menu_layout_ready || !loggedIn) {
                button.classList.remove('add_to_menu_btn_ready');
                button.disabled = true;
                button.setAttribute('aria-disabled', 'true');
                return;
            }
            button.disabled = false;
            button.removeAttribute('aria-disabled');
            var objType = button.getAttribute('data-obj-type');
            var objId = button.getAttribute('data-obj-id');
            if (objType && objId) {
                set_add_to_menu_button_state(button, !!custom[custom_menu_id(objType, objId)]);
                button.classList.add('add_to_menu_btn_ready');
            }
        });
        var headerButton = by_id('ctrl_add_to_menu');
        if (!headerButton) {
            return;
        }
        if (!menu_layout_ready) {
            headerButton.classList.remove('ctrl_add_to_menu_ready', 'added', 'ctrl_add_to_menu_default');
            headerButton.disabled = true;
            headerButton.setAttribute('hidden', 'hidden');
            headerButton.setAttribute('aria-hidden', 'true');
            headerButton.setAttribute('aria-disabled', 'true');
            return;
        }
        headerButton.disabled = false;
        var isDefault = is_default_menu_page();
        var entry = isDefault ? null : pin_target_entry();
        if (!loggedIn || (!entry && !isDefault)) {
            headerButton.classList.remove('ctrl_add_to_menu_ready', 'added', 'ctrl_add_to_menu_default');
            headerButton.removeAttribute('aria-disabled');
            headerButton.setAttribute('hidden', 'hidden');
            headerButton.setAttribute('aria-hidden', 'true');
            headerButton.disabled = true;
        } else if (isDefault) {
            headerButton.classList.remove('added');
            headerButton.classList.add('ctrl_add_to_menu_ready', 'ctrl_add_to_menu_default');
            headerButton.removeAttribute('hidden');
            headerButton.setAttribute('aria-hidden', 'false');
            headerButton.setAttribute('aria-disabled', 'true');
            headerButton.setAttribute('title', headerButton.getAttribute('data-title-default') || '');
            headerButton.setAttribute('aria-label', headerButton.getAttribute('data-title-default') || '');
        } else {
            set_add_to_menu_button_state(headerButton, !!custom[custom_menu_id(entry.obj_type, entry.obj_id)]);
            headerButton.classList.remove('ctrl_add_to_menu_default');
            headerButton.classList.add('ctrl_add_to_menu_ready');
            headerButton.removeAttribute('hidden');
            headerButton.setAttribute('aria-hidden', 'false');
            headerButton.removeAttribute('aria-disabled');
        }
    }
    window.refresh_menu_pin_buttons = refresh_menu_pin_buttons;

    function start_menu_sortable(menuInner) {
        if (typeof window.Sortable !== 'function') {
            return false;
        }
        menu_sortable = new window.Sortable(menuInner, {
            animation: 150,
            handle: '.menu_item_drag_handle',
            ghostClass: 'is-being-dragged',
            filter: '#menu_edit_hover_slot',
            onEnd: save_menu_layout,
        });
        return true;
    }

    function report_sortable_load_failure() {
        menu_sortable_loading = false;
        report_menu_pin_error('sortable_load_failure');
        show_menu_runtime_notice(intl('Menu reordering could not load. Close and reopen the editor to retry.', {
            context: 'Visible error when the editable menu drag-and-drop library fails to load',
        }));
    }

    function enter_menu_edit_mode() {
        ensure_authoritative_menu_layout(function () {
            var menu = editable_menu_root();
            var menuInner = menu_inner_el();
            if (!menu_layout_ready || !menu || !menuInner) {
                return;
            }
            pin_edit_chrome();
            set_edit_chrome_reveal(false);
            menu.classList.add('edit_menu');
            update_add_divider_state();
            if (menu_sortable || menu_sortable_loading) {
                return;
            }
            if (typeof window.Sortable === 'function') {
                start_menu_sortable(menuInner);
                return;
            }
            menu_sortable_loading = true;
            var script = document.createElement('script');
            script.src = 'https://' + app_media_domain + '/assets/sortable.min.js?v=2';
            script.onload = function () {
                menu_sortable_loading = false;
                if (typeof window.Sortable !== 'function') {
                    script.remove();
                    report_sortable_load_failure();
                    return;
                }
                if (menu.classList.contains('edit_menu')) {
                    start_menu_sortable(menuInner);
                }
            };
            script.onerror = function () {
                script.remove();
                report_sortable_load_failure();
            };
            document.head.appendChild(script);
        });
    }

    function exit_menu_edit_mode() {
        var menu = editable_menu_root();
        if (menu) {
            menu.classList.remove('edit_menu');
        }
        if (menu_sortable) {
            menu_sortable.destroy();
            menu_sortable = null;
        }
        clear_menu_reset_confirmation();
        reset_menu_pin_search(false);
    }

    document.addEventListener('click', function (e) {
        var resetButton = e.target.closest('#menu_edit_reset');
        if (!resetButton) {
            clear_menu_reset_confirmation();
        }
        var menu = editable_menu_root();
        if (menu && menu.classList.contains('edit_menu')) {
            var row = e.target.closest('#menu.menu_pins [data-menu-item="true"]');
            var control = e.target.closest('.menu_item_drag_handle, .menu_item_hide_toggle, .menu_item_remove');
            if (row && !control) {
                e.preventDefault();
                return;
            }
        }
        var headerButton = e.target.closest('#ctrl_add_to_menu');
        if (headerButton) {
            e.preventDefault();
            ensure_authoritative_menu_layout(function () {
                if (!menu_layout_ready) {
                    return;
                }
                try {
                    if (!is_default_menu_page()) {
                        toggle_pin_target(pin_target_entry(), function (added) {
                            set_add_to_menu_button_state(headerButton, added);
                        });
                    }
                } catch (error) {
                    report_menu_pin_error('click_handler: ' + error.message);
                }
            });
            return;
        }
        var addButton = e.target.closest('.add_to_menu_btn');
        if (addButton) {
            e.preventDefault();
            ensure_authoritative_menu_layout(function () {
                if (!menu_layout_ready) {
                    return;
                }
                toggle_add_menu_item(addButton);
            });
            return;
        }
        if (e.target.closest('#menu_edit_toggle')) {
            if (!menu_layout_ready) {
                return;
            }
            enter_menu_edit_mode();
            return;
        }
        if (e.target.closest('#menu_edit_done')) {
            exit_menu_edit_mode();
            return;
        }
        if (resetButton) {
            if (!confirm_menu_reset(resetButton)) {
                return;
            }
            ensure_authoritative_menu_layout(function () {
                if (!menu_layout_ready) {
                    return;
                }
                reset_menu_layout();
            });
            return;
        }
        if (e.target.closest('#menu_add_divider')) {
            ensure_authoritative_menu_layout(function () {
                if (!menu_layout_ready) {
                    return;
                }
                add_menu_divider();
            });
            return;
        }
        var removeControl = e.target.closest('.menu_item_remove');
        if (removeControl) {
            e.preventDefault();
            e.stopPropagation();
            ensure_authoritative_menu_layout(function () {
                if (!menu_layout_ready) {
                    return;
                }
                remove_custom_menu_item(removeControl.getAttribute('data-menu-id'));
            });
            return;
        }
        var toggle = e.target.closest('.menu_item_hide_toggle');
        if (toggle) {
            e.preventDefault();
            e.stopPropagation();
            ensure_authoritative_menu_layout(function () {
                if (!menu_layout_ready) {
                    return;
                }
                var willHide = toggle.classList.contains('checked');
                toggle.classList.toggle('checked');
                toggle.setAttribute('aria-checked', willHide ? 'false' : 'true');
                var toggleRow = toggle.closest('[data-menu-item="true"]');
                if (toggleRow) {
                    toggleRow.classList.toggle('hidden_menu_item', willHide);
                }
                save_menu_layout();
            });
        }
    });

    document.addEventListener('keydown', function (e) {
        if ((e.key === 'Enter' || e.key === ' ') && e.target.closest && e.target.closest('.menu_item_hide_toggle, .menu_item_remove')) {
            e.preventDefault();
            e.target.closest('.menu_item_hide_toggle, .menu_item_remove').click();
        }
    });

    function menu_crossed_free_host() {
        try {
            if (!document.referrer) {
                return false;
            }
            var refHost = new URL(document.referrer).hostname;
            var here = location.hostname;
            var refFree = refHost.indexOf('free.') === 0;
            var hereFree = here.indexOf('free.') === 0;
            return refFree !== hereFree;
        } catch (e) {
            return false;
        }
    }

    function bootstrap_editable_menu() {
        // Sidebar chrome only on #menu.menu_pins. Header pin controls still
        // run below so pages with #menu.dashboard_menu (e.g. characters) can pin.
        if (is_editable_sidebar_menu()) {
            pin_edit_chrome();
            bind_edit_chrome_pull();
            bind_dashboard_inject_repair();
        }
        var loggedIn = menu_layout_user_id() > 0;
        var hasCache = !!cached_menu_state;
        if (!loggedIn) {
            menu_layout_authoritative = true;
            set_menu_controls_ready(true);
            return;
        }
        // Page cache often bakes MENU_LAYOUT_USER_ID=0, so menu.php's early
        // localStorage apply is skipped. Paint the cached layout immediately;
        // lazy account sync still reconciles with the server afterward.
        // apply_menu_layout is a no-op without menu.php; safe on dashboard_menu pages.
        if (hasCache && is_editable_sidebar_menu()) {
            apply_menu_layout_snapshot(confirmed_menu_layout);
        }
        // Optimistic ready from localStorage (or empty default) avoids chicken-and-egg
        // with controls gated on menu_layout_ready.
        set_menu_controls_ready(true);
        // Free Mode subdomain hops often land with empty localStorage until storage
        // sync returns. Don't wait on idle/interaction — fetch account layout now
        // (T-8526). Cached paint still wins immediately when localStorage is warm.
        if (!hasCache || menu_crossed_free_host()) {
            ensure_authoritative_menu_layout();
        } else {
            schedule_lazy_menu_sync('interaction');
        }
    }
    if (document.readyState === 'complete') {
        bootstrap_editable_menu();
    } else {
        document.addEventListener('DOMContentLoaded', bootstrap_editable_menu, { once: true });
    }
})();
