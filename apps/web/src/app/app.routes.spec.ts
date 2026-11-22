import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { routes } from './app.routes';
import { Login } from './features/auth/login';
import { Home } from './features/public/home';
import { Search } from './features/public/search';
import { NotFound } from './shared/not-found';

describe('app routes', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter(routes), provideHttpClient(), provideHttpClientTesting()],
    });
  });

  it.each([
    ['/', Home],
    ['/login', Login],
    ['/search', Search],
    ['/no-such-page', NotFound],
  ])('renders %s', async (url, component) => {
    const harness = await RouterTestingHarness.create();
    const shown = await harness.navigateByUrl(url);
    expect(shown).toBeInstanceOf(component);
  });
});
