'use strict';

var kleissner = kleissner || {};

// Tools page (/tools): every tool's behaviour lives here; the page's stylesheet is tools.css.
kleissner.tools = (function () {

    var osintPost,
        setText,
        setStatus,
        isVisible,
        dropZone,
        fillTable,
        tableFilter,
        fileOnUploadOnFile,
        readDocFile,
        readMagicFile,
        readPdfFile,
        readSelectorFile,
        fileOnUpload,
        downloadText,
        geoIPLookupOnClick,
        openMultipleUrlOnClick,
        magicOnUpload,
        magicOnUploadOnFile,
        magicUploadButtonOnClick,
        nav2ItemOnClick,
        pdfImagesExtract,
        pdfOnUpload,
        selectAllOnClick,
        searchEngines,
        searchEngineBtnOnClick,
        searchEngineTwitterBtnOnClick,
        searchEngineTwitterTweets,
        searchEngineTwitterOpen,
        searchEngineTelegram1,
        searchEngineTelegram2,
        selectorExtract,
        selectorExtractBtnOnClick,
        selectorFileOnUpload,
        showTab,
        emailVerifyButtonOnClick,
        toolsOnEnter,
        init;

    // setText writes a plain-text message into an element, or a centred message when centred is set.
    setText = function setText(el, text, centred) {
      el.textContent = '';
      if (centred) {
        var div = document.createElement('div');
        div.className = 'centerMsg';
        div.textContent = text;
        el.appendChild(div);
        return;
      }
      el.textContent = text;
    };

    // setStatus shows the tool's .info line with the given state text (Processing..., Finished, Error).
    setStatus = function setStatus(paneId, text) {
      var info = byId(paneId).querySelector('.info');
      show(info);
      info.querySelector('span').textContent = text;
    };

    isVisible = function isVisible(el) {
      return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    };

    // osintPost sends a JSON body to the OSINT service and hands the parsed answer to success; any non-2xx or network
    // failure goes to error.
    osintPost = function osintPost(url, data, success, error) {
      fetch('https://osint.intelx.io' + url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
        body: data
      }).then(function (response) {
        if (!response.ok) {
          throw new Error('HTTP ' + response.status);
        }
        return response.json();
      }).then(success).catch(function (e) {
        if (error) {
          error(e);
        }
      });
    };

    // downloadText offers text as a .txt file named after the uploaded document.
    downloadText = function downloadText(text, fileName) {
      var element = document.createElement('a');
      element.setAttribute('href', 'data:text/plain;charset=utf-8,' + encodeURIComponent(text));
      element.setAttribute('download', fileName.substring(0, fileName.lastIndexOf('.')) + '.txt');
      hide(element);
      document.body.appendChild(element);
      element.click();
      document.body.removeChild(element);
    };
    // fillTable renders rows into the table body: one <tr> per row, one <td> per field, as text.
    // The footer line below the table shows the row count and receives the CSV download link.
    fillTable = function fillTable(table, rows, fields, csvHref, csvName) {
      var tbody = table.querySelector('tbody');
      tbody.textContent = '';
      rows.forEach(function (row) {
        var tr = document.createElement('tr');
        fields.forEach(function (field) {
          var td = document.createElement('td');
          td.textContent = row[field] === undefined || row[field] === null ? '' : String(row[field]);
          tr.appendChild(td);
        });
        tbody.appendChild(tr);
      });
      if (rows.length === 0) {
        var empty = document.createElement('tr');
        var cell = document.createElement('td');
        cell.colSpan = fields.length;
        cell.className = 'toolsTableEmpty';
        cell.textContent = 'No matching records found';
        empty.appendChild(cell);
        tbody.appendChild(empty);
      }
      var footer = table.nextElementSibling;
      footer.textContent = '';
      if (rows.length > 0) {
        var link = document.createElement('a');
        link.href = csvHref;
        link.download = csvName;
        link.className = 'toolsTableDownload';
        var icon = document.createElement('i');
        icon.className = 'fa fa-floppy-o';
        icon.setAttribute('data-tooltip', 'Download');
        icon.setAttribute('data-placement', 'top');
        link.appendChild(icon);
        footer.appendChild(link);
        var info = document.createElement('span');
        info.textContent = rows.length + (rows.length === 1 ? ' row' : ' rows');
        footer.appendChild(info);
      }
      tableFilter(table);
    };

    // tableFilter adds the filter dropdown to every header cell: sort A to Z / Z to A, a search box and
    // one checkbox per distinct value of the column. Rows whose value is unchecked in any column are hidden.
    tableFilter = function tableFilter(table) {
      var ths = Array.prototype.slice.call(table.querySelectorAll('thead th'));
      var rows = Array.prototype.slice.call(table.querySelectorAll('tbody tr')).filter(function (row) {
        return !row.querySelector('.toolsTableEmpty');
      });
      var menus = [];

      function compare(a, b) {
        var na = Number(a), nb = Number(b);
        if (a !== '' && b !== '' && !isNaN(na) && !isNaN(nb)) {
          return na - nb;
        }
        var la = a.toLowerCase(), lb = b.toLowerCase();
        return la < lb ? -1 : la > lb ? 1 : 0;
      }

      function cellText(row, column) {
        return row.children[column].textContent.trim();
      }

      // a row stays visible when every column has its value checked
      function updateVisibility() {
        rows.forEach(function (row) {
          var visible = menus.every(function (menu) {
            return menu.checked[cellText(row, menu.column)] !== false;
          });
          setVisible(row, visible);
        });
      }

      function sortRows(column, descending) {
        rows.sort(function (a, b) {
          var r = compare(cellText(a, column), cellText(b, column));
          return descending ? -r : r;
        });
        var tbody = table.querySelector('tbody');
        rows.forEach(function (row) {
          tbody.appendChild(row);
        });
      }

      ths.forEach(function (th, column) {
        var old = th.querySelector('.dropdown-filter-dropdown');
        if (old) {
          old.remove();
        }
        var menu = { column: column, checked: {} };
        menus.push(menu);

        var values = [];
        rows.forEach(function (row) {
          var v = cellText(row, column);
          if (values.indexOf(v) < 0) {
            values.push(v);
          }
        });
        values.sort(compare);
        values.forEach(function (v) {
          menu.checked[v] = true;
        });

        // header text in its own span so it can shorten with an ellipsis while the arrow keeps its place
        if (!th.querySelector('.toolsTableHeaderText')) {
          var label = document.createElement('span');
          label.className = 'toolsTableHeaderText';
          label.textContent = th.textContent.trim();
          th.textContent = '';
          th.appendChild(label);
        }
        var dropdown = document.createElement('div');
        dropdown.className = 'dropdown-filter-dropdown';
        var trigger = document.createElement('span');
        trigger.className = 'dropdown-filter-icon';
        var arrow = document.createElement('i');
        arrow.className = 'arrow-down';
        trigger.appendChild(arrow);
        dropdown.appendChild(trigger);

        var content = document.createElement('div');
        content.className = 'dropdown-filter-content hidden';

        function sortItem(label, descending) {
          var div = document.createElement('div');
          div.className = 'dropdown-filter-sort';
          var span = document.createElement('span');
          span.textContent = label;
          div.appendChild(span);
          div.addEventListener('click', function () {
            sortRows(column, descending);
          });
          return div;
        }
        content.appendChild(sortItem('A to Z', false));
        content.appendChild(sortItem('Z to A', true));

        var searchDiv = document.createElement('div');
        searchDiv.className = 'dropdown-filter-search';
        var search = document.createElement('input');
        search.type = 'text';
        search.className = 'form-control';
        search.placeholder = 'Search';
        searchDiv.appendChild(search);
        content.appendChild(searchDiv);

        var list = document.createElement('div');
        list.className = 'checkbox-container';
        var boxes = [];

        function item(label, onChange) {
          var div = document.createElement('div');
          div.className = 'dropdown-filter-item';
          var box = document.createElement('input');
          box.type = 'checkbox';
          box.checked = true;
          box.addEventListener('change', onChange);
          div.appendChild(box);
          div.appendChild(document.createTextNode(' ' + label));
          list.appendChild(div);
          return box;
        }

        var selectAll = item('Select All', function () {
          search.value = '';
          boxes.forEach(function (b) {
            b.checked = selectAll.checked;
            menu.checked[b.value] = selectAll.checked;
          });
          updateVisibility();
        });
        values.forEach(function (v) {
          var box = item(v, function () {
            search.value = '';
            menu.checked[v] = box.checked;
            selectAll.checked = boxes.every(function (b) { return b.checked; });
            updateVisibility();
          });
          box.value = v;
          boxes.push(box);
        });
        content.appendChild(list);

        // typing checks exactly the values containing the text; an empty box checks all again
        search.addEventListener('keyup', function () {
          var text = search.value.toLowerCase();
          boxes.forEach(function (b) {
            b.checked = text === '' || b.value.toLowerCase().indexOf(text) > -1;
            menu.checked[b.value] = b.checked;
          });
          selectAll.checked = text === '';
          updateVisibility();
        });

        dropdown.appendChild(content);
        th.insertBefore(dropdown, th.firstChild);

        trigger.addEventListener('click', function () {
          setVisible(content, content.classList.contains('hidden'));
        });
        document.addEventListener('click', function (event) {
          if (!dropdown.contains(event.target)) {
            hide(content);
          }
        });
      });
    };

    // dropZone makes an element accept a dropped file: highlights it while dragging over and passes the first file to onFile.
    dropZone = function dropZone(el, onFile) {
      if (!el) {
        return;
      }
      function over(event) {
        event.preventDefault();
        el.classList.add('state-over');
      }
      el.addEventListener('dragenter', over);
      el.addEventListener('dragover', over);
      el.addEventListener('dragleave', function () {
        el.classList.remove('state-over');
      });
      el.addEventListener('drop', function (event) {
        event.preventDefault();
        el.classList.remove('state-over');
        if (event.dataTransfer.files.length > 0) {
          onFile(event.dataTransfer.files[0]);
        }
      });
    };

    fileOnUploadOnFile = function fileOnUploadOnFile(event) {
      event.preventDefault();
      readDocFile(event.target.files[0]);
    };

    readDocFile = function readDocFile(file) {
      var reader = new FileReader();
      reader.onload = function() {
        fileOnUpload(file.name, reader.result);
      };
      reader.onerror = function () {
        setText(byId('fileUploadOutputPre'), 'An error has occured while reading the file.', true);
      };
      reader.readAsDataURL(file);
    };

    fileOnUpload = function fileOnUpload(fileName, fileResult) {
      byId('docLabel').textContent = fileName;
      setText(byId('fileUploadOutputPre'), 'Loading...', true);
      setStatus('document2text', 'Processing...');
      osintPost(
        '/document/2text',
        JSON.stringify({ filename: fileName, data: fileResult.substr(fileResult.indexOf(',') + 1)}),
        function(data) {
          setStatus('document2text', 'Finished');
          byId('fileUploadOutputPre').textContent = data.text;
          byId('docDownload').onclick = function() {
            downloadText(data.text, fileName);
          };
          show(byId('docDownload'));
        },
        function() {
          byId('docDownload').onclick = null;
          hide(byId('docDownload'));
          setStatus('document2text', 'Error');
          setText(byId('fileUploadOutputPre'), 'An error has occured while reading the file.', true);
        }
      );
    };

    geoIPLookupOnClick = function geoIPLookupOnClick(event) {
      event.preventDefault();
      osintPost(
        '/geoip/lookup',
        JSON.stringify({ text: byId('geoIPInput').value.replace(' ', '\n') }),
        function(data) {
          if ( !! data ) {
            var table = byId('geoIPTable');
            hide(table);
            var rows = data.map(function(v) {
              return { ip: v.ip, city: v.city, country: v.country, countrycode: v.countrycode, timezone: v.timezone, latitude: v.latitude, longitude: v.longitude, as: v.as };
            });
            var csvContent = "data:text/csv;charset=utf-8,sep=,\r\nIP,City,Country,ISO,Timezone,Latitude,Longitude,Autonomous System\r\n";
            rows.forEach(function(row) {
              csvContent += row.ip + ',' + row.city + ',' + row.country + ',' + row.countrycode + ',' + row.timezone + ',' + row.latitude + ',' + row.longitude + ',' + row.as + '\r\n';
            });
            fillTable(table, rows, ['ip', 'city', 'country', 'countrycode', 'timezone', 'latitude', 'longitude', 'as'], encodeURI(csvContent), 'IPs.csv');
            show(table);
          }
        }
      );
    };

    openMultipleUrlOnClick = function openMultipleUrlOnClick(event) {
      event.preventDefault();
      byId('openMultipleUrlLines').value.split('\n').forEach(function (line) {
        var link = line.trim();
        if ( link === '' ) {
          return;
        }
        if ( link.indexOf('http://') > -1 || link.indexOf('https://') > -1 ) {
          window.open(link, '_blank');
        } else {
          window.open('https://' + link, '_blank');
        }
      });
    };

    magicOnUploadOnFile = function magicOnUploadOnFile(event) {
      event.preventDefault();
      readMagicFile(event.target.files[0]);
    };

    readMagicFile = function readMagicFile(file) {
      var reader = new FileReader();
      reader.onload = function() {
        magicOnUpload(file.name, reader.result);
      };
      reader.onerror = function (error) {
        console.log(error)
      };
      reader.readAsDataURL(file);
    };

    magicOnUpload = function magicOnUpload(fileName, fileResult) {
      byId('magicLabel').textContent = fileName;
      var textChecked = byId('magicOption1').checked;
      var metaDataChecked = byId('magicOption2').checked;
      var selectorsChecked = byId('magicOption3').checked;
      var imagesChecked = byId('magicOption4').checked;
      var textPre = byId('magicTextPre'), metaPre = byId('magicMetaPre'), selectorTable = byId('magicSelectorTable');
      var imagesLink = byId('magicImagesDownload'), imagesError = imagesLink.parentElement.querySelector('.error');
      if ( textChecked ) {
        setText(textPre, 'Loading...', true);
        show(textPre);
      } else {
        setText(textPre, 'The text from the document will appear here.', true);
        hide(textPre);
      }
      byId('magicDownload').onclick = null;
      hide(byId('magicDownload'));
      if ( metaDataChecked ) {
        setText(metaPre, 'Loading...', true);
        show(metaPre);
      } else {
        setText(metaPre, 'The metadata from the document will appear here.', true);
        hide(metaPre);
      }
      imagesLink.setAttribute('href', '');
      hide(imagesLink);
      fillTable(selectorTable, [], ['selector', 'type'], '', '');
      if ( selectorsChecked ) {
        show(selectorTable);
      } else {
        hide(selectorTable);
      }
      setStatus('filetool', 'Processing...');
      osintPost(
        '/magic/file',
        JSON.stringify({
          filename: fileName,
          data: fileResult.substr(fileResult.indexOf(',') + 1),
          option1: textChecked,
          option2: metaDataChecked,
          option3: selectorsChecked,
          option4: imagesChecked
        }),
        function(data) {
          setStatus('filetool', 'Finished');
          if ( textChecked ) {
            if ( !! data.text ) {
              textPre.textContent = data.text;
              byId('magicDownload').onclick = function() {
                downloadText(data.text, fileName);
              };
              show(byId('magicDownload'));
            } else {
              setText(textPre, 'An error has occured while reading the file.', true);
            }
          }
          if ( metaDataChecked ) {
            if ( !! data.metadata ) {
              metaPre.textContent = data.metadata;
            } else {
              setText(metaPre, 'An error has occured while reading the file.', true);
            }
          }
          if ( selectorsChecked ) {
            var rows = data.selector.map(function(v) {
              return { selector: v.selector, type: v.type };
            });
            var csvContent = "data:text/csv;charset=utf-8,sep=,\r\nSelector,Type\r\n";
            rows.forEach(function(row) {
              csvContent += row.selector + ',' + row.type + '\r\n';
            });
            fillTable(selectorTable, rows, ['selector', 'type'], encodeURI(csvContent), 'Selector_Extraction.csv');
            show(selectorTable);
          }
          imagesError.textContent = '';
          hide(imagesError);
          if ( imagesChecked ) {
            if ( data.image.status == "Success" ) {
              if ( data.image.count > 0 ) {
                show(imagesLink);
                imagesLink.setAttribute('href', data.image.link);
              } else {
                imagesLink.setAttribute('href', '');
                hide(imagesLink);
                imagesError.textContent = 'No images could be found on pdf.';
                show(imagesError);
              }
            } else {
              var info = imagesLink.parentElement.querySelector('.info');
              hide(info);
              info.querySelector('span').textContent = '';
              imagesLink.setAttribute('href', '');
              hide(imagesLink);
              imagesError.textContent = data.image.status;
              show(imagesError);
            }
          }
        },
        function() {
          byId('magicDownload').onclick = null;
          hide(byId('magicDownload'));
          hide(imagesLink);
          setStatus('filetool', 'Error');
          if ( textChecked ) {
            setText(textPre, 'An error has occured while reading the file.', true);
          }
          if ( metaDataChecked ) {
            setText(metaPre, 'An error has occured while reading the file.', true);
          }
        }
      );
    };

    // the label opens the file dialog; clearing the input lets the same file be chosen again
    magicUploadButtonOnClick = function magicUploadButtonOnClick() {
      byId('magicFileUpload').value = '';
    };

    // showTab activates the tool named in the left menu (data-tab) and its pane; the menu's own click handler in
    // ui.js switches the Bootstrap tab, this keeps the URL (?tab=) and the browser history in step with it.
    showTab = function showTab(tab) {
      document.querySelectorAll('.nav2 > a').forEach(function (a) {
        a.classList.remove('active');
      });
      var link = document.querySelector('.nav2[data-tab="' + tab + '"] > a');
      if (link) {
        link.classList.add('active');
      }
      document.querySelectorAll('.tab2').forEach(function (pane) {
        pane.classList.remove('active');
      });
      var pane = byId(tab);
      if (pane) {
        pane.classList.add('active');
      }
    };

    nav2ItemOnClick = function nav2ItemOnClick(event, item) {
      var tab = item.getAttribute('data-tab');
      window.history.pushState({ page: 'tools', tab: tab }, null, './tools?tab=' + tab);
      window.scrollTo(0, 0);
    };

    pdfImagesExtract = function(filename, text) {
      byId('pdfLabel').textContent = filename;
      var link = byId('pdfImagesDownload'), info = link.parentElement.querySelector('.info'), error = link.parentElement.querySelector('.error');
      show(info);
      info.querySelector('span').textContent = 'Processing...';
      osintPost(
        '/document/2images',
        JSON.stringify({ filename: filename, data: text }),
        function(data) {
          if ( data.status == "Success" ) {
            show(info);
            info.querySelector('span').textContent = 'Finished';
            if ( data.count > 0 ) {
              show(link);
              link.setAttribute('href', data.link);
              error.textContent = '';
              hide(error);
            } else {
              link.setAttribute('href', '');
              hide(link);
              error.textContent = 'No images could be found on pdf.';
              show(error);
            }
          } else {
            hide(info);
            info.querySelector('span').textContent = '';
            link.setAttribute('href', '');
            hide(link);
            error.textContent = data.status;
            show(error);
          }
        }
      )
    };

    pdfOnUpload = function pdfOnUpload(event) {
      event.preventDefault();
      readPdfFile(event.target.files[0]);
    };

    readPdfFile = function readPdfFile(file) {
      var reader = new FileReader();
      reader.onload = function() {
        pdfImagesExtract(file.name, reader.result.substr(reader.result.indexOf(',') + 1));
      };
      reader.readAsDataURL(file);
    };

    // "Select all" ticks every visible search-engine checkbox of its kind (.selectAll -> .searchEngineCheckbox,
    // .selectAll11 -> .searchEngineCheckbox11, .selectAll12 -> .searchEngineCheckbox12).
    selectAllOnClick = function selectAllOnClick(event, button) {
      event.preventDefault();
      var kind = button.classList.contains('selectAll11') ? '11' : button.classList.contains('selectAll12') ? '12' : '';
      document.querySelectorAll('.searchEngineCheckbox' + kind).forEach(function (box) {
        if (isVisible(box)) {
          box.checked = true;
        }
      });
    };

    // searchEngines opens every ticked engine of the pane with the placeholders in its URL replaced by the
    // (URL-encoded) values; engines marked data-post get the raw first value into their hidden form and are submitted.
    // values: { '%s': text } or several placeholders like { '%f': first, '%l': last }; empty values mean no search.
    searchEngines = function searchEngines(paneId, values, checkboxClass) {
      var keys = Object.keys(values);
      for (var i = 0; i < keys.length; i++) {
        if (!values[keys[i]]) {
          return;
        }
      }
      var raw = values[keys[0]];
      byId(paneId).querySelectorAll('.' + (checkboxClass || 'searchEngineCheckbox') + ':checked').forEach(function (box) {
        if (!box.getAttribute('data-post')) {
          var url = box.value;
          keys.forEach(function (key) {
            // split/join replaces every occurrence; String.replace with a string pattern only replaces the first
            url = url.split(key).join(encodeURIComponent(values[key]));
          });
          if (paneId === 'email') {
            url = url.replace('%raw', raw);
          }
          window.open(url, '_blank');
        } else {
          var input = byId(box.id + 'Input');
          if (input) {
            input.value = raw;
          }
          byId(box.id + 'Form').submit();
        }
      });
    };

    // one handler for the 17 search buttons: the button id's number selects the pane and its inputs
    searchEngineBtnOnClick = function searchEngineBtnOnClick(event, button) {
      event.preventDefault();
      var n = button.id.substring('searchEngineBtn'.length);
      var value = function (suffix) {
        var input = byId('searchEngineInput' + n + (suffix || ''));
        return input ? input.value : undefined;
      };
      switch (n) {
        case '1': searchEngines('general', { '%s': value() }); break;
        case '2': searchEngines('email', { '%s': value() }); break;
        case '3': searchEngines('domain', { '%s': value() }); break;
        case '4': searchEngines('bitcoin', { '%s': value() }); break;
        case '5': searchEngines('ip', { '%s': value() }); break;
        case '6': searchEngines('image', { '%s': value() }); break;
        case '7': searchEngines('username', { '%s': value() }); break;
        case '8': searchEngines('person', { '%f': value('FirstName'), '%l': value('LastName') }); break;
        case '9': searchEngines('location', { '%1': value('Latitude'), '%2': value('Longitude') }); break;
        case '10':
          window.open('https://www.linkedin.com/search/results/people/?keywords=' + value('Keyword') + '&firstName=' + value('FirstName') + '&lastName=' + value('LastName') + '&title=' + value('Title') + '&company=' + value('CompanyName'), '_blank');
          break;
        case '11': searchEngines('telephone', { '%1': value('Phone1'), '%2': value('Phone2'), '%3': value('Phone3') }, 'searchEngineCheckbox11'); break;
        case '12': searchEngines('telephone', { '%s': value('PhoneInt') }, 'searchEngineCheckbox12'); break;
        case '13': searchEngines('file', { '%s': value() }); break;
        case '14': searchEngines('vin', { '%s': value() }); break;
        case '15': searchEngines('hash', { '%s': value() }); break;
        case '16': searchEngines('analytics', { '%s': value() }); break;
        case '17': searchEngines('adsense', { '%s': value() }); break;
      }
    };

    searchEngineTwitterBtnOnClick = function searchEngineTwitterBtnOnClick(event) {
      event.preventDefault();
      var value = byId('searchEngineTwitter').value;
      if ( !! value ) {
        if ( byId('searchEngineTwitterCheckbox').checked ) {
          window.open('https://x.com/search?f=user&q=' + value, '_blank');
        } else {
          window.open('https://x.com/search?f=users&q=' + value, '_blank');
        }
      }
    };

    searchEngineTwitterTweets = function searchEngineTwitterTweets(event) {
      event.preventDefault();
      var latitude = byId('searchEngineTwitterLatitude').value;
      var longitude = byId('searchEngineTwitterLongitude').value;
      var distance = byId('searchEngineTwitterDistance').value;
      if ( !! latitude && !! longitude && !! distance ) {
        window.open('https://x.com/search?l=&q=geocode:' + latitude + ',' + longitude +',' + distance + 'km', '_blank');
      }
    };

    searchEngineTwitterOpen = function searchEngineTwitterOpen(event) {
      event.preventDefault();
      var value = byId('searchEngineTwitter2').value;
      if ( !! value ) {
        window.open('https://x.com/' + value, '_blank');
      }
    };

    searchEngineTelegram1 = function searchEngineTelegram1(event) {
      event.preventDefault();
      var value = byId('searchEngineTelegram').value;
      if ( !! value ) {
        window.open('https://cse.google.com/cse?cx=004805129374225513871:p8lhfo0g3hg&q=' + value, '_blank');
      }
    };

    searchEngineTelegram2 = function searchEngineTelegram2(event) {
      event.preventDefault();
      var value = byId('searchEngineTelegram').value;
      if ( !! value ) {
        window.open('https://cse.google.com/cse?cx=006368593537057042503:efxu7xprihg&q=' + value, '_blank');
      }
    };

    selectorExtract = function selectorExtract(filename, text) {
      byId('selectorLabel').textContent = filename;
      setStatus('text2selector', 'Processing...');
      osintPost(
        '/selector/extract',
        JSON.stringify({ filename: filename, data: text }),
        function(data) {
          var rows = (data || []).map(function(v) {
            return { selector: v.selector, type: v.type };
          });
          setStatus('text2selector', 'Finished');
          var csvContent = "data:text/csv;charset=utf-8,sep=,\r\nSelector,Type\r\n";
          rows.forEach(function(row) {
            csvContent += row.selector + ',' + row.type + '\r\n';
          });
          var table = byId('selectorExtractTable');
          fillTable(table, rows, ['selector', 'type'], encodeURI(csvContent), 'Selector_Extraction.csv');
          show(table);
        },
        function() {
          setStatus('text2selector', 'Error');
        }
      )
    };

    selectorExtractBtnOnClick = function selectorExtractBtnOnClick(event) {
      event.preventDefault();
      selectorExtract('Input.txt', btoa(byId('selectorInput').value));
    };

    selectorFileOnUpload = function selectorFileOnUpload(event) {
      event.preventDefault();
      readSelectorFile(event.target.files[0]);
    };

    readSelectorFile = function readSelectorFile(file) {
      var reader = new FileReader();
      reader.onload = function() {
        selectorExtract(file.name, reader.result.substr(reader.result.indexOf(',') + 1));
      };
      reader.readAsDataURL(file);
    };

    // Enter in a tool's input presses the tool's search button
    toolsOnEnter = function toolsOnEnter(event) {
      if (event.keyCode == '13') {
        document.querySelectorAll('.toolsPage .tab2.active .searchEngineBtn').forEach(function (button) {
          button.click();
        });
      }
    };

    emailVerifyButtonOnClick = function emailVerifyButtonOnClick(event) {
      event.preventDefault();
      setStatus('emailvalidate', 'Processing...');
      osintPost(
        '/email/verify',
        JSON.stringify({ text: byId('emailVerifyInput').value.replace(' ', '\n') }),
        function(data) {
          if ( !! data ) {
            var table = byId('emailVerifyTable');
            hide(table);
            var rows = data.map(function(v) {
              return { email: v.email, domain: v.domain, tld: v.tld, user: v.user, status: v.status, info: v.info };
            });
            setStatus('emailvalidate', 'Finished');
            var csvContent = "data:text/csv;charset=utf-8,sep=,\r\nEmail,Domain,TLD,User,Status,Information\r\n";
            rows.forEach(function(row) {
              csvContent += row.email + ',' + row.domain + ',' + row.tld + ',' + row.user + ',' + row.status + ',' + row.info + '\r\n';
            });
            fillTable(table, rows, ['email', 'domain', 'tld', 'user', 'status', 'info'], encodeURI(csvContent), 'Email_Validation.csv');
            show(table);
          }
        },
        function() {
          setStatus('emailvalidate', 'Error');
        }
      );
    };

    init = function init() {
      document.addEventListener('input', function (event) {
        switch (event.target.id) {
          case 'docFileUpload': fileOnUploadOnFile(event); break;
          case 'magicFileUpload': magicOnUploadOnFile(event); break;
          case 'pdfFileUpload': pdfOnUpload(event); break;
          case 'selectorFileUpload': selectorFileOnUpload(event); break;
        }
      });
      onClick('#geoIPLookup', geoIPLookupOnClick);
      onClick('#openMultipleUrl', openMultipleUrlOnClick);
      onClick('#magicUploadButton', magicUploadButtonOnClick);
      onClick('.nav2', nav2ItemOnClick);
      onClick('.selectAll, .selectAll11, .selectAll12', selectAllOnClick);
      onClick('[id^="searchEngineBtn"]', searchEngineBtnOnClick);
      onClick('#searchEngineTwitterBtn', searchEngineTwitterBtnOnClick);
      onClick('#searchEngineTwitterTweets', searchEngineTwitterTweets);
      onClick('#searchEngineTwitterOpen', searchEngineTwitterOpen);
      onClick('#searchEngineTelegram1', searchEngineTelegram1);
      onClick('#searchEngineTelegram2', searchEngineTelegram2);
      onClick('#selectorExtractButton', selectorExtractBtnOnClick);
      onClick('#emailVerifyButton', emailVerifyButtonOnClick);
      onClick('#ytformInputButton', youtubeLookup);
      document.addEventListener('keyup', toolsOnEnter);
      // Code tab: the encode/decode buttons transform the text area in place, the hash buttons hash #hashinput
      onClick('#codeForm [data-code]', function (event, button) {
        var text = byId('codeText');
        text.value = codeTransforms[button.getAttribute('data-code')](text.value);
      });
      onClick('[data-hash]', function (event, button) {
        hashText(button.getAttribute('data-hash'));
      });
      var codeText = byId('codeText');
      if (codeText) {
        codeText.addEventListener('focus', function () {
          if (codeText.value === 'Enter text to encode or decode here.') {
            codeText.value = '';
          }
        });
      }
      // The Code and URL-opener forms only hold inputs for buttons; Enter must not submit them
      ['codeForm', 'listUrlsForm'].forEach(function (id) {
        var form = byId(id);
        if (form) {
          form.addEventListener('submit', function (event) {
            event.preventDefault();
          });
        }
      });
      // Facebook tab: the search links follow the keyword and date fields
      [['input-exact-day-keyword', 'keyup', generate_url_day_exact], ['hey', 'change', generate_url_day_exact],
       ['input-exact-month-keyword', 'keyup', generate_url_month_exact], ['hey2', 'change', generate_url_month_exact],
       ['input-timerange-keyword', 'keyup', generate_url_timerange], ['from-input', 'change', generate_url_timerange],
       ['until-input', 'change', generate_url_timerange]].forEach(function (binding) {
        var input = byId(binding[0]);
        if (input) {
          input.addEventListener(binding[1], binding[2]);
        }
      });
      var fbSearchType = byId('fb_select_search_type');
      if (fbSearchType) {
        fbSearchType.addEventListener('change', function () {
          show_only(fbSearchType);
        });
      }
      // Alternative Facebook Graph Searcher: filter buttons, date filter, URL and clear buttons
      onClick('[data-fb-filter]', function (event, button) {
        add_filter(button, button.getAttribute('data-fb-filter'));
      });
      onClick('#fb-date-filter', add_date_filter);
      onClick('#fb-show-url', function () {
        alert(make_url());
      });
      onClick('#fb-open-url', function () {
        window.open(make_url());
      });
      onClick('#fb-clear-filters', clear_filters);
      var tab = GET_URL_PARAMETER('tab');
      if (typeof tab !== 'undefined') {
        showTab(tab);
        window.history.replaceState({ page: 'tools', tab: tab }, null, '/tools?tab=' + tab);
      }
      window.addEventListener('popstate', function (event) {
        if (event.state && event.state.page === 'tools') {
          showTab(event.state.tab);
        }
      });
      [['emailVerifyTable', 6], ['selectorExtractTable', 2], ['magicSelectorTable', 2], ['geoIPTable', 8]].forEach(function (t) {
        var table = byId(t[0]);
        if (table) {
          fillTable(table, [], new Array(t[1]), '', '');
        }
      });
      dropZone(byId('dropzoneUpload'), readDocFile);
      dropZone(byId('selectorUpload'), readSelectorFile);
      dropZone(byId('pdfUpload'), readPdfFile);
      dropZone(byId('magicUpload'), readMagicFile);
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
    } else {
      init();
    }

    return {
      osintPost: osintPost,
      fileOnUpload: fileOnUpload,
      magicOnUpload: magicOnUpload,
      pdfImagesExtract: pdfImagesExtract,
      selectorExtract: selectorExtract
    }

}());


// Code tab: encoders and hashes. Text is handled as its UTF-8 bytes; results are strings for the text areas.

function utf8Bytes(str) {
    return new TextEncoder().encode(str);
}

function utf8String(bytes) {
    return new TextDecoder().decode(bytes);
}

function bytesToHex(bytes) {
    var hex = '';
    for (var i = 0; i < bytes.length; i++) {
        hex += (bytes[i] < 16 ? '0' : '') + bytes[i].toString(16);
    }
    return hex;
}

// codeTransforms maps the data-code value of a Code tab button to its text transformation
var codeTransforms = {
    urlEncode: urlEncode,
    urlDecode: urlDecode,
    encodeBase64: encodeBase64,
    decodeBase64: decodeBase64,
    encodeHex: encodeHex,
    decodeHex: decodeHex
};

function urlEncode(str) {
    return encodeURIComponent(str).split('%20').join('+');
}

function urlDecode(str) {
    try {
        return decodeURIComponent(str.split('+').join(' '));
    } catch (e) {
        return str;
    }
}

function encodeBase64(str) {
    var bytes = utf8Bytes(str);
    var binary = '';
    for (var i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

function decodeBase64(str) {
    var compact = str.split(' ').join('').split('\n').join('').split('\r').join('').split('\t').join('');
    try {
        var binary = atob(compact);
    } catch (e) {
        return str;
    }
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return utf8String(bytes);
}

function encodeHex(str) {
    return bytesToHex(utf8Bytes(str));
}

function decodeHex(str) {
    var digits = '';
    for (var i = 0; i < str.length; i++) {
        var c = str.charAt(i).toLowerCase();
        if ('0123456789abcdef'.indexOf(c) > -1) {
            digits += c;
        }
    }
    var bytes = new Uint8Array(digits.length >> 1);
    for (var j = 0; j < bytes.length; j++) {
        bytes[j] = parseInt(digits.substr(j * 2, 2), 16);
    }
    return utf8String(bytes);
}

// hashText writes the digest of #hashinput into #hashoutput. algorithm: 'MD5', 'SHA-1', 'SHA-256' or 'SHA-512'.
function hashText(algorithm) {
    var input = document.getElementById('hashinput').value;
    var output = document.getElementById('hashoutput');
    var bytes = utf8Bytes(input);
    if (algorithm === 'MD5') {
        output.value = bytesToHex(md5(bytes));
        return;
    }
    crypto.subtle.digest(algorithm, bytes).then(function (digest) {
        output.value = bytesToHex(new Uint8Array(digest));
    });
}

// md5 returns the 16-byte MD5 digest of the bytes (RFC 1321). Kept in own code because WebCrypto offers no MD5.
function md5(bytes) {
    var K = [], S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
    for (var i = 0; i < 64; i++) {
        K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296);
    }
    var length = bytes.length;
    var padded = new Uint8Array(((length + 8) >> 6 << 6) + 64);
    padded.set(bytes);
    padded[length] = 0x80;
    var view = new DataView(padded.buffer);
    view.setUint32(padded.length - 8, length << 3, true);
    view.setUint32(padded.length - 4, Math.floor(length / 536870912), true);

    var a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
    for (var offset = 0; offset < padded.length; offset += 64) {
        var M = [];
        for (var w = 0; w < 16; w++) {
            M[w] = view.getUint32(offset + w * 4, true);
        }
        var A = a0, B = b0, C = c0, D = d0;
        for (var j = 0; j < 64; j++) {
            var F, g;
            if (j < 16) {
                F = (B & C) | (~B & D);
                g = j;
            } else if (j < 32) {
                F = (D & B) | (~D & C);
                g = (5 * j + 1) % 16;
            } else if (j < 48) {
                F = B ^ C ^ D;
                g = (3 * j + 5) % 16;
            } else {
                F = C ^ (B | ~D);
                g = (7 * j) % 16;
            }
            var sum = (A + F + K[j] + M[g]) >>> 0;
            var shift = S[(j >> 4) * 4 + (j % 4)];
            F = ((sum << shift) | (sum >>> (32 - shift))) >>> 0;
            A = D;
            D = C;
            C = B;
            B = (B + F) >>> 0;
        }
        a0 = (a0 + A) >>> 0;
        b0 = (b0 + B) >>> 0;
        c0 = (c0 + C) >>> 0;
        d0 = (d0 + D) >>> 0;
    }
    var digest = new Uint8Array(16);
    var out = new DataView(digest.buffer);
    out.setUint32(0, a0, true);
    out.setUint32(4, b0, true);
    out.setUint32(8, c0, true);
    out.setUint32(12, d0, true);
    return digest;
}

// Facebook Graph Searcher. Both halves of the tab build a facebook.com/search URL whose
// filters parameter is base64 JSON; Facebook only applies it for logged-in users.

// dateParts splits the value of a native date/month input ("2024-03-07" or "2024-03") into
// [year, month, day] strings without leading zeros; missing parts are undefined.
function dateParts(value) {
    var arr = value.split("-");
    var parts = [arr[0]];
    for (var i = 1; i < arr.length; i++) {
        parts.push(String(Number(arr[i])));
    }
    return parts;
}

function generate_url(keyword, year, month, day, endYear, endMonth, endDay) {
    if (endYear === undefined) {
        endYear = year;
    }

    if (month === undefined) {
        month = 1;
        endMonth = 12;
    } else if (endMonth === undefined) {
        endMonth = month;
    }

    if (day === undefined) {
        day = 1;
        endDay = new Date(endYear, endMonth, 0).getDate();
    } else if (endDay === undefined) {
        endDay = day;
    }

    var layer3 = {
        "start_year": year,
        "start_month": year + "-" + month,
        "end_year": endYear,
        "end_month": endYear + "-" + endMonth,
        "start_day": year + "-" + month + '-' + day,
        "end_day": endYear + "-" + endMonth + '-' + endDay
    };

    var layer2 = {
        "name": "creation_time",
        "args": JSON.stringify(layer3)
    };

    var layer1 = {
        "rp_creation_time": JSON.stringify(layer2),
        "rp_author": "{\"name\":\"merged_public_posts\",\"args\":\"\"}"
    };

    var b64Filter = btoa(JSON.stringify(layer1));

    return 'https://m.facebook.com/search/top/?q=' + encodeURIComponent(keyword) + '&filters=' + b64Filter + '&epa=FILTERS';
}

function generate_url_day_exact() {
    var keyword = byId('input-exact-day-keyword').value;
    var arr = dateParts(byId('hey').value);

    if (arr[2] === undefined) {
        return;
    }

    byId('btn-search-exact-day').setAttribute('href', generate_url(keyword, arr[0], arr[1], arr[2]));
}

function generate_url_month_exact() {
    var keyword = byId('input-exact-month-keyword').value;
    var arr = dateParts(byId('hey2').value);

    if (arr[1] === undefined) {
        return;
    }

    byId('btn-search-exact-month').setAttribute('href', generate_url(keyword, arr[0], arr[1]));
}

function generate_url_timerange() {
    var keyword = byId('input-timerange-keyword').value;
    var date1 = dateParts(byId('from-input').value);
    var date2 = dateParts(byId('until-input').value);

    if (date1[2] === undefined || date2[2] === undefined) {
        return;
    }

    byId('btn-search-timerange').setAttribute('href', generate_url(keyword, date1[0], date1[1], date1[2], date2[0], date2[1], date2[2]));
}

// The Facebook date inputs accept dates up to today.
document.addEventListener('DOMContentLoaded', function () {
    var today = new Date();
    var todayISO = today.getFullYear() + "-" + String(today.getMonth() + 1).padStart(2, "0") + "-" + String(today.getDate()).padStart(2, "0");
    ['hey', 'from-input', 'until-input'].forEach(function (id) {
        var input = byId(id);
        if (input) {
            input.setAttribute('max', todayISO);
        }
    });
    var month = byId('hey2');
    if (month) {
        month.setAttribute('max', todayISO.substring(0, 7));
    }
});

// Alternative Facebook Graph Searcher
var search_types = ['top', 'videos', 'posts', 'people', 'photos', 'pages', 'places', 'events'];
var filters = [];
function clear_filters() {
    filters = [];
    document.getElementById('fb-current-filters').innerHTML = '';
    var elements = document.getElementsByTagName("input");
    for (var ii = 0; ii < elements.length; ii++) {
        if (elements[ii].type == "text") {
            elements[ii].value = "";
        }
    }
}
function make_url() {
    var search_keyword = document.getElementById("fb_search_keyword").value;
    var search_type = document.getElementById('fb_select_search_type').value;
    if (search_types.indexOf(search_type) < 0) {
        alert('Search type ' + search_type + ' not existing');
        return;
    }
    if (!search_keyword) {
        search_keyword = '*';
    }
    var joined_filters = '{' + filters.join() + '}';
    var encoded_filters = btoa(joined_filters).replace('=', '');
    var search_url = 'https://m.facebook.com/search/' + search_type + '/?q=';
    search_url += search_keyword + '&epa=FILTERS&filters=' + encoded_filters;
    return search_url;
}
function add_filter(obj, arg_name) {
    var filter_name = obj.className;
    var value_field = filter_name + '-' + arg_name;
    var arg_value = document.getElementsByClassName(value_field);
    var value = '';
    for (var i = 0; i < arg_value.length; i++) {
        if (arg_value[i].value) {
            value = arg_value[i].value;
            break;
        }
    }
    //console.log(value);
    filters.push('"' + filter_name + '":"{\\"name\\":\\"' + arg_name + '\\",\\"args\\":\\"' + value + '\\"}"');
    var filters_div = document.getElementById('fb-current-filters');
    filters_div.innerHTML += '<li><b>' + filter_name + '</b> { ' + arg_name + ' : ' + value + '}</li>';
}
function add_date_filter() {
    var start_year = document.getElementById('start_year').value;
    var start_month = start_year + '-' + document.getElementById('start_month').value;
    var start_day = start_month + '-' + document.getElementById('start_day').value;
    var end_year = document.getElementById('end_year').value;
    var end_month = end_year + '-' + document.getElementById('end_month').value;
    var end_day = end_month + '-' + document.getElementById('end_day').value;
    var search_type = document.getElementById('fb_select_search_type').value;
    var filter = '';
    if (search_type == 'events') {
        var date_interval = start_day + '~' + end_day;
        filter = '"rp_events_date":"{\\"name\\":\\"filter_events_date\\",\\"args\\":\\"' + date_interval + '\\"}"';
        var filters_div = document.getElementById('fb-current-filters');
        filters_div.innerHTML += '<li><b> rp_events_date </b> {"name":"filter_events_date","args":"' + date_interval + '"}</li>';
    } else {
        filter = '"rp_creation_time":"{\\"name\\":\\"creation_time\\",\\"args\\":\\"{\\\\\\"start_year\\\\\\":\\\\\\"' + start_year + '\\\\\\",\\\\\\"start_month\\\\\\":\\\\\\"' + start_month + '\\\\\\",\\\\\\"end_year\\\\\\":\\\\\\"' + end_year + '\\\\\\",\\\\\\"end_month\\\\\\":\\\\\\"' + end_month + '\\\\\\",\\\\\\"start_day\\\\\\":\\\\\\"' + start_day + '\\\\\\",\\\\\\"end_day\\\\\\":\\\\\\"' + end_day + '\\\\\\"}\\"}"';
        var filters_div = document.getElementById('fb-current-filters');
        filters_div.innerHTML += '<li><b> rp_creation_time </b> {"start_year":"' + start_year + '","start_month":"' + start_month + '","end_year":"' + end_year + '","end_month":"' + end_month + '","start_day":"' + start_day + '","end_day":"' + end_day + '"}</li>';
    }
    filters.push(filter);
}
function show_only(obj) {
    var divsToHide = document.getElementsByClassName("fb_search_category");
    for (var i = 0; i < divsToHide.length; i++) {
        hide(divsToHide[i]);
    }
    show(document.getElementById(obj.value));
    show(document.getElementById("fb-filter-keywords"));
    show(document.getElementById("fb-filter-dates"));
    show(document.getElementById("fb-final-buttons"));
    show(document.getElementById("fb-current-filters"));
    clear_filters();
}




// fork of YouTube DataViewer (wired in kleissner.tools init: #ytformInputButton -> youtubeLookup)

/* 
 * 
 * url variables function ==>
 *************************/
function getVars(theString){
	var vars = [], hash;
	var hashes = theString.slice(theString.indexOf('?') + 1).split('&');
	for(var i = 0; i < hashes.length; i++){
		hash = hashes[i].split('=');
		vars.push(hash[0]);
		vars[hash[0]] = hash[1];
	}
	
	return vars;
}

// YouTube tab: the button fetches the video's metadata from the YouTube Data API and renders it below.
function youtubeLookup() {
    var input = document.getElementById('ytformInput');
    var output = document.getElementById('ytshortOutput');
    var formUrl = input.value.trim();
    if (formUrl === '') {
        alert('Please input a URL');
        return;
    }
    var urlV = getVars(formUrl)['v'];
    var theUrl = 'https://www.googleapis.com/youtube/v3/videos?id=' + urlV + '&part=snippet,statistics,recordingDetails&key=AIzaSyB9pXF76kFAYcMrjMCq_BHVjp1WeBp1ue8';
    fetch(theUrl).then(function (response) {
        return response.json().then(function (data) {
            if (response.ok) {
                output.innerHTML = processShort(data, formUrl);
                return;
            }
            var reason = response.status === 403 && data && data.error && data.error.errors && data.error.errors[0] ? data.error.errors[0].reason : '';
            if (reason === 'quotaExceeded' || reason === 'dailyLimitExceeded') {
                output.innerHTML = '<div class="alert alert-danger">API quota exceeded.</div>';
            }
        });
    });
}

/* 
 * 
 * process api data ==>
 *************************/
function processShort(data,formUrl){
	var returnString = '';
	
	returnString = '<h2><a href="'+formUrl+'" target="new" style="font-size:18px;">'+data.items[0]['snippet']['title']+'</a></h2>';
	returnString += '<pre style="min-height:0;">'+data.items[0]['snippet']['description']+'</pre><br />';
	returnString += '<strong>Metadata</strong><br /><pre>';
	returnString += 'Video ID:                 '+data.items[0]['id']+'\n';
	returnString += 'Upload Date:              '+dateTimeConvert(data.items[0]['snippet']['publishedAt'],'date')+'\n';
	returnString += 'Upload Time:              '+dateTimeConvert(data.items[0]['snippet']['publishedAt'],'time')+' UTC\n';
	returnString += 'Channel ID:               '+data.items[0]['snippet']['channelId']+'\n';
	returnString += 'Channel Title:            '+data.items[0]['snippet']['channelTitle']+'\n';
	returnString += 'Default Audio Language:   '+data.items[0]['snippet']['defaultAudioLanguage']+'\n';
	returnString += 'Tags:                     '+data.items[0]['snippet']['tags']+'\n';
	returnString += 'Comments:                 '+data.items[0]['statistics']['commentCount']+'\n';
	returnString += 'Dislikes:                 '+data.items[0]['statistics']['dislikeCount']+'\n';
	//returnString += 'Favorites:                '+data.items[0]['statistics']['favoriteCount']+'\n'; // always 0
	returnString += 'Likes:                    '+data.items[0]['statistics']['likeCount']+'\n';
	returnString += 'Views:                    '+data.items[0]['statistics']['viewCount']+'\n';
    returnString += '</pre>';

	var urlVars = getVars(window.location.href);
	if((urlVars['geo']) && (urlVars['geo'] == 'true')) {
		if(typeof data.items[0]['recordingDetails'] != 'undefined'){
			var lat = data.items[0]['recordingDetails']['location']['latitude'];
			var lon = data.items[0]['recordingDetails']['location']['longitude'];
			returnString += '<strong>Recording Location:</strong> '+lat+', '+lon+' (<a href="https://www.google.com/maps/search/'+lat+',+'+lon+'" target="new">view map</a>)'+'<br />';
		} else {
			returnString += '<br /><strong>Recording location is not available.</strong>';
		}
	}
	
	
	returnString += '<div class="previewThumb" style="margin-top:30px;"><span class="center" style="font-size:16px;font-weight:bold;">Thumbnails:</span></div>';
	
	for(var i=0;i<4;i++){
		returnString += '<div class="previewThumb" style="margin-top:10px;"><img src="https://img.youtube.com/vi/'+data.items[0]['id']+'/'+i+'.jpg"/> <a href="https://www.google.com/searchbyimage?image_url=https://img.youtube.com/vi/'+data.items[0]['id']+'/'+i+'.jpg" target="new">reverse image search</a></div>';
	}
	
	returnString += '<div class="bottomSpacer">&nbsp;</div>';
	
	return returnString;
}
/* 
 * 
 * adjust time/date strings ==>
 *************************/
function dateTimeConvert(string,returnOption){
	if(returnOption == 'date'){ string = string.substring(0,10); }
	if(returnOption == 'time'){ string = string.substring(11,19); }
	if(returnOption == 'convert'){
		var string1 = string.substring(0,4);
		var string2 = string.substring(5,7);
		var string3 = string.substring(8,10);
		var string4 = string.substring(11,13);
		var string5 = string.substring(14,16);
		string = string1+string2+string3+'T'+string4+string5;
	}
	return string;
}
