const viewLinks = document.querySelectorAll('[data-view-link]');
const views = document.querySelectorAll('[data-view]');

function showView(name) {
  views.forEach((view) => { view.hidden = view.dataset.view !== name; });
  viewLinks.forEach((link) => {
    const active = link.dataset.viewLink === name;
    link.classList.toggle('active', active);
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

viewLinks.forEach((link) => link.addEventListener('click', (event) => {
  event.preventDefault();
  showView(link.dataset.viewLink);
}));

document.querySelectorAll('[data-go-waits]').forEach((link) => link.addEventListener('click', (event) => {
  event.preventDefault();
  showView('waits');
}));

document.querySelectorAll('[data-go-home]').forEach((link) => link.addEventListener('click', (event) => {
  event.preventDefault();
  showView('home');
}));
