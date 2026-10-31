// Strategy pattern: how a "similar existing report" is found. Swap or tune without touching the service.
class SameCategoryWithinRadius {
  constructor(repo, radiusM) { this.repo = repo; this.radiusM = radiusM; }
  async findDuplicateId({ category, lat, lng }) { return this.repo.findOpenNearbyId(category, lat, lng, this.radiusM); }
}
module.exports = { SameCategoryWithinRadius };
