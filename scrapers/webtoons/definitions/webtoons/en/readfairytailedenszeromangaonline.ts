import { MangaCatalogScraper } from '../../../engine/mangacatalog';

export class ReadfairytailedenszeromangaonlineScraper extends MangaCatalogScraper {
  constructor() {
    super('Read Fairy Tail & Edens Zero Manga Online', 'https://ww9.readfairytail.com', 'en');
    this.sourceList = [
      { name: "Eden's Zero", url: `${this.baseUrl}/manga/edens-zero/` },
      { name: 'Fairy Tail', url: `${this.baseUrl}/manga/fairy-tail/` },
      { name: 'FT Zero', url: `${this.baseUrl}/manga/fairy-tail-zero/` },
      { name: 'FT City Hero', url: `${this.baseUrl}/manga/fairy-tail-city-hero/` },
      { name: 'Hero’s', url: `${this.baseUrl}/manga/heros/` },
      { name: 'FT Happy Adv', url: `${this.baseUrl}/manga/fairy-tail-happys-grand-adventure/` },
      { name: 'FT 100 Year', url: `${this.baseUrl}/manga/fairy-tail-100-years-quest/` },
      { name: 'FT Ice Trail', url: `${this.baseUrl}/manga/fairy-tail-ice-trail/` },
      { name: 'FT x Taizai', url: `${this.baseUrl}/manga/fairy-tail-x-nanatsu-no-taizai-christmas-special/` },
      { name: 'Parasyte x FT', url: `${this.baseUrl}/manga/parasyte-x-fairy-tail/` },
      { name: 'Gaiden 1', url: `${this.baseUrl}/manga/fairy-tail-gaiden-raigo-issen/` },
      { name: 'FT x Rave', url: `${this.baseUrl}/manga/fairy-tail-x-rave/` },
      { name: 'Monster Hunter', url: `${this.baseUrl}/manga/monster-hunter-orage/` },
      { name: 'Rave Master', url: `${this.baseUrl}/manga/rave-master/` },
      { name: 'Dead Rock', url: `${this.baseUrl}/manga/dead-rock/` },
      { name: 'Fairy Girls', url: `${this.baseUrl}/manga/fairy-girls/` },
      { name: 'Gaiden 4', url: `${this.baseUrl}/manga/fairy-tail-gaiden-raigo-issen/` },
      { name: 'Gaiden 2', url: `${this.baseUrl}/manga/fairy-tail-gaiden-kengami-no-souryuu/` },
      { name: 'Gaiden 3', url: `${this.baseUrl}/manga/fairy-tail-gaiden-road-knight/` },
      { name: 'FT x 7DS', url: `${this.baseUrl}/manga/fairy-tail-x-nanatsu-no-taizai-christmas-special/` },
    ];
  }
}