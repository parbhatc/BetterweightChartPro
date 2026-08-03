import assert from 'node:assert/strict'
import test from 'node:test'
import {
  hoverBoxIdAt,
  resolveVerticalLabelStack,
} from '../public/js/indicators/primitives/boxes.js'

const priceToY = (price) => 500 - price

test('indicator boxes expose grouped hover details inside their time and price region', () => {
  const boxes = [{
    timeStart: 100,
    timeEnd: 200,
    priceTop: 120,
    priceBottom: 100,
    hoverId: 'setup-7-trade',
    hoverLabel: 'Setup 7',
  }]

  assert.equal(hoverBoxIdAt(boxes, 150, 390, priceToY), 'setup-7-trade')
  assert.equal(hoverBoxIdAt(boxes, 250, 390, priceToY), null)
  assert.equal(hoverBoxIdAt(boxes, 150, 350, priceToY), null)
})

test('extended indicator boxes remain hoverable after their initial end time', () => {
  const boxes = [{
    timeStart: 100,
    timeEnd: 120,
    extendRight: true,
    priceTop: 120,
    priceBottom: 100,
    hoverLabel: 'Open position',
  }]

  assert.equal(hoverBoxIdAt(boxes, 500, 390, priceToY), 'Open position')
})

test('position-style box stats activate hover without a floating tooltip label', () => {
  const boxes = [{
    timeStart: 100,
    timeEnd: 200,
    priceTop: 120,
    priceBottom: 100,
    hoverId: 'setup-7',
    hoverStats: { entryPrice: 110, targetPrice: 120, stopPrice: 100 },
  }]

  assert.equal(hoverBoxIdAt(boxes, 150, 390, priceToY), 'setup-7')
})

test('small position setups stack hover labels without collisions', () => {
  const resolved = resolveVerticalLabelStack([
    { top: 100, height: 28 },
    { top: 105, height: 60 },
    { top: 112, height: 28 },
  ], 240)

  const sorted = [...resolved].sort((a, b) => a.top - b.top)
  assert.ok(sorted[1].top >= sorted[0].top + sorted[0].height + 4)
  assert.ok(sorted[2].top >= sorted[1].top + sorted[1].height + 4)
  assert.ok(sorted[0].top >= 4)
  assert.ok(sorted[2].top + sorted[2].height <= 236)
})
