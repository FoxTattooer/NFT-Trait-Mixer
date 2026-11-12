/* Approve a proposed name and location before changing the editable inventory. */
(() => {
  'use strict';
  const model = window.TraitInventoryBase;
  const skinPreviews = {"Silver":"data:image/jpeg;base64,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","Red":"data:image/jpeg;base64,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","Gold":"data:image/jpeg;base64,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","Mosaic":"data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAUEBAQEAwUEBAQGBQUGCA0ICAcHCBALDAkNExAUExIQEhIUFx0ZFBYcFhISGiMaHB4fISEhFBkkJyQgJh0gISD/2wBDAQUGBggHCA8ICA8gFRIVICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICD/wAARCABEAEEDASIAAhEBAxEB/8QAHAAAAQUBAQEAAAAAAAAAAAAAAAMEBQcIBgIB/8QAMxAAAQMDAgMHAgUFAQAAAAAAAQIDBAAFERIhBkFRBxMiMWFxkRQyFTNCUqEIIySBsYL/xAAaAQACAwEBAAAAAAAAAAAAAAABAgADBAUG/8QAJhEAAgICAQMEAgMAAAAAAAAAAAECEQMEMRIhIgUTQWEyQlGB8P/aAAwDAQACEQMRAD8AzUck5NPG/wAtPtXrbpTRz81XvTiisjyTSKPvT706t7P1EoM96hrV5rcOAkeZNWPbeye7XeMh9hx9pl1GULfj6Mq57as49f4opCyko8ld00e/NVVrOf0+do6my/AhxpjGMhYfCCfTSedcHcOHr3Yv7d3tciGoEpy4nbPTPkfOlTTdINrkh4/3n2pwftPtSUjZA96bg7iiEPH60U+0iiiQa9+voKUDSXAFnOVb0l3DnQfNKpcShIQo7gb7UCExw3BnSb42zbmVugpK5AGNmRjUTnl5VsXhZ9bkFpiSpPhbSkHV4cAYwAdwaybwDPXH4s/x0LdW/GdZDaRurIB6jAwkknoK1BwbIRPjt3Du0LaKQWnVDxLVuCP4ozdQTX8mecYOTlP4XYtCxoWp52OnBGATt9vvXB8f8OsNm5JmpbMdTSnSMZykpOce1WbYUIU06+hOyiEjHPH/AGq37Ybq3b7BeJzriiwy0hDgSkKOnI1DB9zVeDyzdCHkm4KjDjjkeVJdMZLiIpUVNBZGoIz4QcbZx518LCAM5O1O7ouH+P3GRBaDMFyS4qOhIwEtlRKQB0AxTXvmyCATn2qx8stEvqXOiaK89w50FFAg850yc/NV716aQ8+8hllK3HFnSlKRkknyAFd5ZOBpMlpLsmMuQAShXdKAQg7gEq31bjyHzzoOSTSb5GinJqK5ZB8FtR37+tuQXE4juOIWhRSUFCSsnbcgpSpP/qtPdmyYj9ubHdHu/C4Gic45A56bEf6qp08Ow7X/AIf05ClJOp1hOAPPA6nY4Oeg6VYXC9uuD9mYahXWRFjhC+8SnKFLc/SQvH2jG4xz+dW3qPHre5N077HRxaEZNymrr4L2PE0C3JMdT6PqXB4Ghtg8s9KpntTvcFfD67fICJqlZkyI5WCVtIwVg535gbbjcjyp79Lb3Go6pD0iHO1Bt4K3LfVSiTskn9Xlv61VXGUOcbvc5rtskXBl5pyIZDTulcZBOFFKSMLKvFnORgjBGK5mrUHafcq2Nbp8olKScaRgYGfLpTYfcN6mp1lmWxxKnUqcYcQFoc0kYydgofpPp8E0yITpOw8q1mOmn3Pu9FMdSv3H5ooCnddn3D7l1v4bjuFMlZDLJwcjV96hsRsjPMHxA74rS/4E1a7E1EbKER2Rt4QEpQN8nnn1qluyK5xrZcjILp7mOwXpBST4VrVpHhzg4SkHOx8ZHKug7TeNHYsOUmMyXGnmCnvEDSANiDqzuN/mqIY3PYTk/FD+eGUcq/olZ012Er8QiFSWFudyV6ApKiBkjpjPKu04XnNSIbaHGWILshR7pobBzAySPSsqwe0a+IsCrUVuICXULSFDON9XP3qweHeInJyC9LuhaUlvuyt0lRCDyTgHGfT1ru+szxbOCMMKVj6uzsRnK+9/BoO4RFSmGUzI7TzGrSoL3Rj2pLiWVAbtkiMhtp1brPeF5B1acchzPlXI8R8ewbJw7Ct8Za3HCttpawoftJHP0rnYXFzBZk3F4qX9KSlLAG+ydSlH0xk14303SzvZqfZL7OZvbOXJJx4r/USXFnDXDd3tFsh2iT9Yp5kuKQ4ohQcxsDjGkHA2O4OOlZnuDL9vuL0F5PibVpyRjI5H4q2uDu0i03vieUXY5hpQtS2sKyCkA7Y9sfzUF2rWhlF0i3u3o1Q5o1JcGADk5I88kg58hgZGTk13PblBdLd/ZuhNTx3LlFd/TI/caKV1UVKAe4k+bBUtcOU5HU4koXoVjUnoeopSbdrjcYqYs2Up5lIwEEAbf6FFFOOpPpqyPLTZXrKcqwBknkNhTxqdLYRoafUlPTbFFFCfBWelXKetzvFylqVqSvJ38QGAfjavb13uchLqXZrqku51jONWRg5x6UUUYquBaXUMoR/DpCZEIJZdSMBSUg/9qQnX28XOMzGn3B59hjPdtqOEpycnAG3nRRTr8SfsR3xRRRSFh//Z","Cup":"data:image/jpeg;base64,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","Lime":"data:image/jpeg;base64,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","Rainbow":"data:image/jpeg;base64,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"};
  const skin = (name,targetId,reason) => ({ id:`skin-confirm-${name.toLowerCase()}`,name,kind:'layer',parentId:'cat-skin',targetId,reason,image:skinPreviews[name] });
  const defaultSuggestions = [
    skin('Silver','skin-p-02','V nabídce SKIN je vrstva pojmenovaná Silver. V soupisu je zatím mezi plánovanými.'),
    skin('Red','skin-p-03','V nabídce SKIN je vidět Red. Návrh ji spojí s plánovanou položkou.'),
    skin('Gold','skin-p-04','V nabídce SKIN je vidět Gold. Návrh ji spojí s plánovanou položkou.'),
    skin('Mosaic','skin-p-05','V nabídce SKIN je vidět Mosaic. Návrh ji spojí s plánovanou položkou.'),
    skin('Rainbow','skin-p-06','V nabídce SKIN je vidět Rainbow. Návrh ji spojí s plánovanou položkou.'),
    skin('Cup','','V nabídce SKIN je modrá vrstva Cup. Navrhuji ji přidat pod názvem ze screenshotu.'),
    skin('Lime','','V nabídce SKIN je vrstva Lime. Můžeš ji přidat zvlášť nebo přiřadit k plánované Green.'),
    { id:'alias-facee-bandana',name:'Cracked Bandana',kind:'layer',parentId:'cat-facemask',targetId:'mask-11',reason:'Stejný motiv v jiném přehledu má zkrácený popisek Cracked Ban….' },
    { id:'alias-spas12-combo',name:'Spas12 Combo',kind:'layer',parentId:'cat-backtrait',targetId:'back-a-06',reason:'V druhém přehledu je dvojice vrstev označená jako Spas12 Combo.' },
  ];
  const flatten = nodes => nodes.flatMap(node => [node,...flatten(node.children || [])]);
  const option = (value,label,selected) => `<option value="${esc(value)}"${value === selected ? ' selected' : ''}>${esc(label)}</option>`;

  function mount(root, read, write) {
    let editing = '', pending = false;
    function tree() { return model.pathNodes(read().nodes); }
    function folders(nodes) {
      return nodes.filter(model.isBranch).flatMap(node => model.isPlanningGroup(node)
        ? folders(node.children) : [{ ...node, children:folders(node.children) }]);
    }
    function folderPicker(nodes) {
      return `<ul>${nodes.map(node => `<li><button type="button" data-review-parent="${esc(node.id)}" aria-pressed="false">${icon('folder')}<span>${esc(node.name)}</span></button>${node.children.length ? folderPicker(node.children) : ''}</li>`).join('')}</ul>`;
    }
    function syncPaths(form) {
      const branches = tree();
      const parent = form.elements.namedItem('parent').value;
      const target = form.elements.namedItem('target').value;
      form.querySelector('[data-review-path="parent"]').textContent = model.locate(branches,parent)?.item.path || '—';
      form.querySelector('[data-review-path="target"]').textContent = model.locate(branches,target)?.item.path || 'Nová položka';
      for (const button of form.querySelectorAll('[data-review-parent]')) {
        button.setAttribute('aria-pressed',String(button.dataset.reviewParent === parent));
      }
    }
    function leaves(parentId, suggestedId) {
      const branches = tree();
      const parent = model.locate(branches,parentId)?.item;
      const category = branches.find(branch => parent && model.locate([branch],parent.id));
      const candidates = flatten(category?.children || []).filter(node => !model.isBranch(node));
      const suggested = model.locate(branches,suggestedId)?.item;
      if (suggested && !model.isBranch(suggested) && !candidates.some(node => node.id === suggested.id)) candidates.unshift(suggested);
      return candidates;
    }
    function targetOptions(parentId, item, selection) {
      return option('','Přidat jako novou položku',selection) + leaves(parentId,item.targetId).map(node => option(node.id,node.path,selection)).join('');
    }
    function render() {
      const base = read();
      if (!base) { root.textContent = 'Načítám návrhy…'; return; }
      const branches = tree();
      const folderTree = folders(branches);
      const parents = flatten(folderTree);
      const proposals = base.suggestions.filter(item => item.status === 'pending');
      if (!proposals.some(item => item.id === editing)) editing = '';
      root.innerHTML = proposals.length ? `<p class="inventory-review-count">Čeká na schválení <strong>${proposals.length}</strong></p>` + proposals.map(item => {
        let location = model.locate(branches,item.parentId);
        while (location && model.isPlanningGroup(location.item)) location = model.locate(branches,location.parent?.id);
        const parent = parents.find(node => node.id === location?.item.id);
        const selectedParent = parent?.id || branches[0]?.id || '';
        const target = model.locate(branches,item.targetId)?.item;
        const art = item.image || target?.image;
        return `<article class="inventory-review-card"><div class="inventory-review-head"><div class="inv-art${art ? ' has-art' : ''}" aria-hidden="true">${art ? `<img src="${esc(art)}" alt="" loading="lazy" decoding="async">` : icon('layers')}</div><div class="inventory-review-name"><h3>${esc(item.name)}</h3>${parent ? `<span>${esc(parent.path)}</span>` : ''}</div>
          ${item.id !== editing ? `<button type="button" class="subtle" data-review-open="${esc(item.id)}">Posoudit</button>` : ''}</div>
          <p>${esc(item.reason)}</p>${item.id === editing ? `<form data-review-form="${esc(item.id)}" class="inventory-review-form" data-parent="${esc(selectedParent)}">
            <label>Název po schválení<input name="name" value="${esc(item.name)}" maxlength="200" required></label>
            <label>Cílová složka<select name="parent" required aria-describedby="inventoryReviewParentPath">${option('','Vybrat složku…',selectedParent)}${parents.map(node => option(node.id,node.path,selectedParent)).join('')}</select></label>
            <p class="inventory-review-path" id="inventoryReviewParentPath">${icon('folder')}<span data-review-path="parent"></span></p>
            <details class="inventory-review-folders"><summary>${icon('folder-tree')}<span>Strom složek</span>${icon('chevron')}</summary>${folderPicker(folderTree)}</details>
            <label>Přiřadit k položce<select name="target" aria-describedby="inventoryReviewTargetPath">${targetOptions(selectedParent,item,target?.id || '')}</select></label>
            <p class="inventory-review-path" id="inventoryReviewTargetPath">${icon('layers')}<span data-review-path="target"></span></p>
            <div class="inventory-review-actions"><button type="button" class="subtle" data-review-dismiss="${esc(item.id)}">Zamítnout</button><button type="submit" class="primary">Schválit a uložit</button></div>
          </form>` : ''}</article>`;
      }).join('') : '<p class="helper">Žádné návrhy ke schválení. Nový návrh můžeš připravit přes ••• u položky v Základu dripd.</p>';
      const form = root.querySelector('form[data-review-form]');
      if (form) {
        const proposal = proposals.find(item => item.id === editing);
        const parent = form.elements.namedItem('parent');
        const target = form.elements.namedItem('target');
        parent.value = form.dataset.parent;
        target.value = [...target.options].some(item => item.value === proposal.targetId) ? proposal.targetId : '';
        syncPaths(form);
      }
    }
    function open(id) { editing = id; render(); }
    root.addEventListener('click',event => {
      const button = event.target.closest('button');
      if (!button || pending) return;
      if (button.dataset.reviewOpen) open(button.dataset.reviewOpen);
      else if (button.dataset.reviewDismiss) void save(button.dataset.reviewDismiss,null);
      else if (button.dataset.reviewParent) {
        const parent = button.form.elements.namedItem('parent');
        parent.value = button.dataset.reviewParent;
        parent.dispatchEvent(new Event('change',{ bubbles:true }));
        button.closest('details').open = false;
        parent.focus({ preventScroll:true });
      }
    });
    root.addEventListener('change',event => {
      const control = event.target;
      if (!['parent','target'].includes(control.name)) return;
      const form = control.closest('form');
      if (control.name === 'parent') {
        const item = read().suggestions.find(entry => entry.id === form.dataset.reviewForm);
        const target = form.elements.namedItem('target');
        const selection = target.value;
        target.innerHTML = targetOptions(control.value,item,selection);
        target.value = [...target.options].some(option => option.value === selection) ? selection : '';
      }
      syncPaths(form);
    });
    root.addEventListener('submit',event => {
      const form = event.target;
      if (!form.dataset.reviewForm) return;
      event.preventDefault();
      const data = new FormData(form);
      void save(form.dataset.reviewForm,{ name:data.get('name'),parentId:data.get('parent'),targetId:data.get('target') });
    });
    async function save(id, values) {
      if (pending) return;
      pending = true;
      const buttons = [...root.querySelectorAll('button')];
      buttons.forEach(button => { button.disabled = true; });
      try {
        await write(base => {
          if (values) model.approveSuggestion(base,id,values);
          else {
            const proposal = base.suggestions.find(item => item.id === id && item.status === 'pending');
            if (proposal) proposal.status = 'dismissed';
          }
        },values ? 'Návrh schválen a uložen do základu.' : 'Návrh zamítnut.');
        editing = ''; render();
      } catch { /* The shared inventory status displays the write error. */ }
      finally { pending = false; buttons.forEach(button => { button.disabled = false; }); }
    }
    return { render,open };
  }
  window.TraitInventoryReview = { mount,defaultSuggestions };
})();
