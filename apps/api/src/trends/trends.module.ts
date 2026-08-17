import { Module } from '@nestjs/common';
import { JsonFeedTrendSource } from './sources/json-feed-trend.source';
import { WikimediaTrendSource } from './sources/wikimedia-trend.source';
import { QianfanBaiduTrendSource } from './sources/qianfan-baidu-trend.source';
import { XWoeidTrendSource } from './sources/x-woeid-trend.source';
import { WeiboOfficialHotWordSource } from './sources/weibo-official-hot-word.source';
import { YouTubeMostPopularSource } from './sources/youtube-most-popular.source';
import { TrendBriefService } from './trend-brief.service';
import { TrendPolicyService } from './trend-policy.service';
import { TrendsController } from './trends.controller';
import { TrendsService } from './trends.service';

@Module({
  controllers: [TrendsController],
  providers: [
    TrendsService,
    TrendBriefService,
    TrendPolicyService,
    WikimediaTrendSource,
    JsonFeedTrendSource,
    QianfanBaiduTrendSource,
    XWoeidTrendSource,
    WeiboOfficialHotWordSource,
    YouTubeMostPopularSource,
  ],
  exports: [TrendBriefService],
})
export class TrendsModule {}
